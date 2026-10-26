import { createHash } from 'node:crypto'
import { MediaAssetId, ShotId, TakeId, WorkspaceId, newId, type ProjectId } from '@ixa/domain'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { closeDbClient, createDbClient, type DbExecutor } from '../client.js'
import { createCharacterRepository } from '../repositories/character-repository.js'
import { createProjectRepository } from '../repositories/project-repository.js'
import { createShotRepository } from '../repositories/shot-repository.js'
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

const CAMERA = JSON.stringify({ size: 'medium', angleH: 'front', angle: 'eye', lensMm: 35, movement: 'push_in', movementIntensity: 'subtle' })

/** 作品・Shot・素材・Take を最小の値で作る（中身は使わない）。 */
const insertShotWithTake = async (tx: DbExecutor, projectId: ProjectId, workspaceId: WorkspaceId, code: string) => {
  const shotId = newId(ShotId)
  const takeId = newId(TakeId)
  const assetId = await anAudio(tx, workspaceId, projectId)
  await tx.execute(sql`insert into shots (id, project_id, "order", code, start_sec, duration_sec, camera, source_type, status)
    values (${shotId}, ${projectId}, ${code === 'IT-A' ? 1000 : 2000}, ${code}, 0, 4, ${CAMERA}::jsonb, '{"type":"ai_video"}'::jsonb, 'draft')`)
  await tx.execute(sql`insert into takes (id, shot_id, index, media_asset_id, spec, spec_hash, provider_id, model_id, provider_params, cost_usd, generation_time_sec)
    values (${takeId}, ${shotId}, 1, ${assetId}, '{}'::jsonb, 'h', 'stub', 'stub', '{}'::jsonb, 0, 0)`)
  return { shotId, takeId }
}

describe.skipIf(url === undefined)('声の差し替えの表（実際の DB）', () => {
  it('採用できるのはその Shot の Take だけ。採用が変わっていれば「元のときだけ採用」は何も書かない', async () => {
    await inRolledBackTransaction(async (tx) => {
      const { projectId, workspaceId } = await aProject(tx)
      const a = await insertShotWithTake(tx, projectId, workspaceId, 'IT-A')
      const b = await insertShotWithTake(tx, projectId, workspaceId, 'IT-B')
      const shots = createShotRepository(tx)
      await expect(shots.selectTake(a.shotId, b.takeId)).rejects.toThrow(/この Shot/)
      expect((await shots.selectTake(a.shotId, a.takeId)).selectedTakeId).toBe(a.takeId)
      expect(await shots.selectTakeIfCurrent(a.shotId, b.takeId, a.takeId)).toBeNull()
      expect(await shots.selectTakeIfCurrent(b.shotId, b.takeId, b.takeId)).toBeNull()
      expect((await shots.selectTakeIfCurrent(a.shotId, a.takeId, a.takeId))?.selectedTakeId).toBe(a.takeId)
      expect(await shots.selectTakeIfCurrent(a.shotId, a.takeId, b.takeId)).toBeNull()
    })
  })

  it('同じワークスペース・同じ鍵の読み上げは 1 行で、2 度目は素材を付け替える。別のワークスペースの行は引かない', async () => {
    await inRolledBackTransaction(async (tx) => {
      const { projectId, workspaceId } = await aProject(tx)
      const other = await aProject(tx)
      const clips = createTtsClipRepository(tx)
      const key = 'c'.repeat(64)
      const first = await clips.save({ workspaceId, cacheKey: key, mediaAssetId: await anAudio(tx, workspaceId, projectId), durationSec: 1.2, costUsd: 0.001 })
      const replacement = await anAudio(tx, workspaceId, projectId)
      const second = await clips.save({ workspaceId, cacheKey: key, mediaAssetId: replacement, durationSec: 1.3, costUsd: 0.002 })
      expect(second.id).toBe(first.id)
      expect(second).toMatchObject({ mediaAssetId: replacement, durationSec: 1.3, costUsd: 0.002 })
      expect((await clips.findByKey(workspaceId, key))?.mediaAssetId).toBe(replacement)
      expect(await clips.findByKey(other.workspaceId, key)).toBeNull()
      const theirs = await clips.save({
        workspaceId: other.workspaceId,
        cacheKey: key,
        mediaAssetId: await anAudio(tx, other.workspaceId, other.projectId),
        durationSec: 2,
        costUsd: 0,
      })
      expect(theirs.id).not.toBe(first.id)
      expect(await clips.findByKey(workspaceId, 'd'.repeat(64))).toBeNull()
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
