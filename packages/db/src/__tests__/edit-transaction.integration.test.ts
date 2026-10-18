import { TimelineClipId, WorkspaceId, newId } from '@ixa/domain'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { closeDbClient, createDbClient, type DbExecutor } from '../client.js'
import { createEditTransaction } from '../repositories/edit-transaction.js'
import { createProjectRepository } from '../repositories/project-repository.js'
import { shotEditBatches } from '../schema/edit-batch.js'
import { timelineClips } from '../schema/timeline.js'
import { workspaces } from '../schema/workspace.js'

/**
 * 取り消しの記録と書き込みは同じトランザクション（2026-10-19 のレビュー）。**実際の Postgres で**、途中で落ちたら
 * 記録も書き込みも残らないことを確かめる（メモリ版は記録しか巻き戻さないので、ここでしか確かめられない）。
 *
 * 走らせるには `DATABASE_URL` が要る（`pnpm --filter @ixa/db exec vitest run edit-transaction --env-file ...` など）。
 * **全部を外側のトランザクションに入れ、最後に必ず巻き戻す**ので、DB には何も残らない。
 * `DATABASE_URL` が無ければ飛ばす（飛ばしたことは vitest の skipped に出る）。
 */

const url = process.env['DATABASE_URL']

class Rollback extends Error {}

/** 外側のトランザクションの中で `body` を走らせ、最後に必ず巻き戻す。 */
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

describe.skipIf(url === undefined)('EditTransaction（実際の DB）', () => {
  it('記録とクリップを書いた後で落ちたら、記録もクリップも残らない', async () => {
    await inRolledBackTransaction(async (tx) => {
      const workspaceId = newId(WorkspaceId)
      await tx.insert(workspaces).values({ id: workspaceId, name: '結合テスト（巻き戻す）' })
      const project = await createProjectRepository(tx).create({
        workspaceId,
        name: '結合テスト（巻き戻す）',
        fps: 24,
        resolution: { width: 1280, height: 720 },
        aspectRatio: '16:9',
      })
      const clipId = newId(TimelineClipId)

      await expect(
        createEditTransaction(tx)(async (repos) => {
          await repos.editBatches.create({ projectId: project.id, kind: 'clip_edit', summary: 'テロップを置く', entries: [], clipEdits: [{ op: 'create', clipId }] })
          await repos.timelineClips.create({
            id: clipId,
            projectId: project.id,
            track: 'TEXT',
            startSec: 0,
            durationSec: 1,
            content: { type: 'text', templateKey: 'plain', params: { text: 'あ' } },
          })
          throw new Error('書いた後で落ちた')
        }),
      ).rejects.toThrow('書いた後で落ちた')

      expect(await tx.select().from(shotEditBatches).where(eq(shotEditBatches.projectId, project.id))).toEqual([])
      expect(await tx.select().from(timelineClips).where(eq(timelineClips.id, clipId))).toEqual([])
      // 落ちなければ両方とも残る（巻き戻しを確かめる相手が本当に書けていることの確認）。
      await createEditTransaction(tx)(async (repos) => {
        await repos.editBatches.create({ projectId: project.id, kind: 'clip_edit', summary: 'テロップを置く', entries: [], clipEdits: [{ op: 'create', clipId }] })
        await repos.timelineClips.create({
          id: clipId,
          projectId: project.id,
          track: 'TEXT',
          startSec: 0,
          durationSec: 1,
          content: { type: 'text', templateKey: 'plain', params: { text: 'あ' } },
        })
      })
      expect(await tx.select().from(shotEditBatches).where(eq(shotEditBatches.projectId, project.id))).toHaveLength(1)
      expect(await tx.select().from(timelineClips).where(eq(timelineClips.id, clipId))).toHaveLength(1)
    })
  })
})
