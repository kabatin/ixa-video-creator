import { createHash } from 'node:crypto'
import { MediaAssetId, WorkspaceId, newId, type ProjectId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { closeDbClient, createDbClient, type DbExecutor } from '../client.js'
import { createCharacterRepository } from '../repositories/character-repository.js'
import { createProjectRepository } from '../repositories/project-repository.js'
import { createTtsClipRepository } from '../repositories/tts-clip-repository.js'
import { createVoiceProfileRepository } from '../repositories/voice-profile-repository.js'
import { mediaAssets } from '../schema/media.js'
import { workspaces } from '../schema/workspace.js'

/**
 * 声の差し替え（ADR-0062 段 5b）の列と表を、**実際の Postgres で**確かめる（0058 を当てた DB）。
 * - 読み上げの保存は同じ鍵で 1 行（同時に 2 つのジョブが同じ文を読んでも、先の行を返す）
 * - キャラクターのセリフの声・距離と、作った声の名札が書いて読める
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

const anAudio = async (tx: DbExecutor, workspaceId: WorkspaceId, projectId: ProjectId) => {
  const id = newId(MediaAssetId)
  await tx.insert(mediaAssets).values({
    id,
    workspaceId,
    projectId,
    kind: 'audio',
    storageKey: `media/${workspaceId}/${id}/original.wav`,
    mimeType: 'audio/wav',
    bytes: 1,
    checksumSha256: createHash('sha256').update(id).digest('hex'),
    origin: { type: 'upload', uploadedBy: 'test' },
  })
  return id
}

describe.skipIf(url === undefined)('声の差し替えの表（実際の DB）', () => {
  it('同じ鍵の読み上げは 1 行で、2 度目は先の行を返す', async () => {
    await inRolledBackTransaction(async (tx) => {
      const { projectId, workspaceId } = await aProject(tx)
      const clips = createTtsClipRepository(tx)
      const key = 'c'.repeat(64)
      const first = await clips.save({ cacheKey: key, mediaAssetId: await anAudio(tx, workspaceId, projectId), durationSec: 1.2, costUsd: 0.001 })
      const second = await clips.save({ cacheKey: key, mediaAssetId: await anAudio(tx, workspaceId, projectId), durationSec: 9, costUsd: 0 })
      expect(second.id).toBe(first.id)
      expect(second.durationSec).toBe(1.2)
      expect((await clips.findByKey(key))?.mediaAssetId).toBe(first.mediaAssetId)
      expect(await clips.findByKey('d'.repeat(64))).toBeNull()
    })
  })

  it('セリフの声・距離・作った声の名札を書いて読める', async () => {
    await inRolledBackTransaction(async (tx) => {
      const { projectId, workspaceId } = await aProject(tx)
      const characters = createCharacterRepository(tx)
      const voices = createVoiceProfileRepository(tx)
      const cat = await characters.create({ workspaceId, projectId, name: 'neko', displayName: 'ネコ' })
      expect(cat).toMatchObject({ dialogueVoiceProfileId: null, dialogueLevelDb: 0 })
      const voice = await voices.create({
        projectId,
        name: 'ネコの声',
        tool: 'gemini_api',
        voiceName: 'voice_abc',
        characterId: cat.id,
        designedVoice: { description: 'やわらかい声', gender: 'female', keyLabel: 'key2-2026-10-14' },
      })
      expect(voice.designedVoice?.keyLabel).toBe('key2-2026-10-14')
      const updated = await characters.update(cat.id, { dialogueVoiceProfileId: voice.id, dialogueLevelDb: -9.5 })
      expect(updated).toMatchObject({ dialogueVoiceProfileId: voice.id, dialogueLevelDb: -9.5 })
      expect((await characters.findById(cat.id))?.dialogueVoiceProfileId).toBe(voice.id)
    })
  })
})
