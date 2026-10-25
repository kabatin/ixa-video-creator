import { MediaAssetId, ModelId, ProviderId, WorkspaceId, newId, type ProjectId } from '@ixa/domain'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { closeDbClient, createDbClient, type DbExecutor } from '../client.js'
import { createImageJobRepository, retryImageJobInput } from '../repositories/image-job-repository.js'
import { createProjectRepository } from '../repositories/project-repository.js'
import { createUploadedSfxRepository } from '../repositories/uploaded-sfx-repository.js'
import { imageGenerationJobs } from '../schema/image-job.js'
import { mediaAssets } from '../schema/media.js'
import { workspaces } from '../schema/workspace.js'

/**
 * 重ねて書かれても行を増やさないこと（レビューの指摘 2026-10-19）を、**実際の Postgres の一意インデックスで**確かめる。
 * - 同じジョブのやり直しは 1 行だけ（チェックの手順が 2 度走っても、やり直しを 2 つ積まない）
 * - 同じ素材の取り込んだ効果音は 1 行だけ（消した行は数えない）
 * - やり直しの元のジョブを消すと、やり直しの行も消える（`retry_of_job_id` が宙に浮かない）
 *
 * `DATABASE_URL` が要る。全部を外側のトランザクションに入れ、最後に必ず巻き戻す。無ければ飛ばす（skipped に出る）。
 */

const url = process.env['DATABASE_URL']

class Rollback extends Error {}

const inRolledBackTransaction = async (body: (tx: DbExecutor) => Promise<void>): Promise<void> => {
  if (url === undefined) throw new Error('DATABASE_URL がありません')
  const db = createDbClient(url, { maxConnections: 1 })
  try {
    await db.transaction(async (tx) => {
      await body(tx)
      throw new Rollback('後片付け')
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  } finally {
    await closeDbClient(db)
  }
}

const aProject = async (tx: DbExecutor): Promise<{ projectId: ProjectId; workspaceId: WorkspaceId }> => {
  const workspaceId = newId(WorkspaceId)
  await tx.insert(workspaces).values({ id: workspaceId, name: '結合テスト（巻き戻す）' })
  const project = await createProjectRepository(tx).create({
    workspaceId,
    name: '結合テスト（巻き戻す）',
    fps: 24,
    resolution: { width: 1280, height: 720 },
    aspectRatio: '16:9',
  })
  return { projectId: project.id, workspaceId }
}

const anAsset = async (tx: DbExecutor, workspaceId: WorkspaceId, projectId: ProjectId, kind: 'image' | 'audio') => {
  const id = newId(MediaAssetId)
  await tx.insert(mediaAssets).values({
    id,
    workspaceId,
    projectId,
    kind,
    storageKey: `media/${workspaceId}/${id}/original.bin`,
    mimeType: kind === 'image' ? 'image/png' : 'audio/wav',
    bytes: 1,
    checksumSha256: 'a'.repeat(64),
    origin: { type: 'upload', uploadedBy: 'test' },
  })
  return id
}

describe.skipIf(url === undefined)('やり直しと取り込んだ効果音の一意（実際の DB）', () => {
  it('同じジョブのやり直しを 2 度作っても 1 行で、2 度目は同じ行を返す。元を消すとやり直しも消える', async () => {
    await inRolledBackTransaction(async (tx) => {
      const { projectId, workspaceId } = await aProject(tx)
      const jobs = createImageJobRepository(tx)
      const first = await jobs.create({
        kind: 'key_art',
        projectId,
        instruction: null,
        providerId: ProviderId.parse('klein'),
        modelId: ModelId.parse('klein/flux-2-klein'),
      })
      await jobs.markChecking(first.id, await anAsset(tx, workspaceId, projectId, 'image'), {}, null)
      const drawn = await jobs.finishChecking(first.id)

      const a = await jobs.create(retryImageJobInput(drawn))
      const b = await jobs.create(retryImageJobInput(drawn))
      expect(b.id).toBe(a.id)
      expect(await tx.select().from(imageGenerationJobs).where(eq(imageGenerationJobs.retryOfJobId, first.id))).toHaveLength(1)

      await tx.delete(imageGenerationJobs).where(eq(imageGenerationJobs.id, first.id))
      expect(await jobs.findById(a.id)).toBeNull()
    })
  })

  it('同じ素材を 2 度取り込んでも 1 行で、2 度目は同じ行を返す', async () => {
    await inRolledBackTransaction(async (tx) => {
      const { projectId, workspaceId } = await aProject(tx)
      const mediaAssetId = await anAsset(tx, workspaceId, projectId, 'audio')
      const sounds = createUploadedSfxRepository(tx)
      const a = await sounds.create({ projectId, mediaAssetId, title: 'ドア' })
      const b = await sounds.create({ projectId, mediaAssetId, title: 'ドア（もう一度）' })
      expect(b.id).toBe(a.id)
      expect(await sounds.findByProject(projectId)).toHaveLength(1)
    })
  })
})
