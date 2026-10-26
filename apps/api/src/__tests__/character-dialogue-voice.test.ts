import { OpenAPIHono } from '@hono/zod-openapi'
import { WorkspaceId, newId } from '@ixa/domain'
import {
  createInMemoryCharacterLookRepository,
  createInMemoryCharacterRepository,
  createInMemoryMediaAssetRepository,
  createInMemoryVoiceProfileRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { FOREIGN_DIALOGUE_VOICE_MESSAGE, characterRoutes } from '../routes/characters.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryEditTransaction } from './in-memory-edit-transaction.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/** キャラクターのセリフの声と距離の既定（ADR-0062）。声は同じ作品の声だけ。距離は -40〜12 dB。 */

const workspaceId = newId(WorkspaceId)
const project = aProject({ workspaceId })
const other = aProject({ workspaceId, name: 'ほかの作品' })

const setup = async (options: { readonly withVoices?: boolean } = {}) => {
  const characters = createInMemoryCharacterRepository()
  const looks = createInMemoryCharacterLookRepository()
  const voices = createInMemoryVoiceProfileRepository()
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route(
    '/',
    characterRoutes({
      characters,
      looks,
      mediaAssets: createInMemoryMediaAssetRepository(),
      projects: createInMemoryProjectRepository([project, other]),
      transaction: createInMemoryEditTransaction({ editBatches: createInMemoryEditBatchRepository(), characters, looks }),
      ...(options.withVoices === false ? {} : { voices }),
    }),
  )
  registerErrorHandlers(app, createLogger('silent'))
  const cat = await characters.create({ workspaceId, projectId: project.id, name: 'neko', displayName: 'ネコ' })
  const mine = await voices.create({ projectId: project.id, name: 'ネコの声', tool: 'gemini_api', voiceName: 'Kore', characterId: cat.id })
  const foreign = await voices.create({ projectId: other.id, name: '別の声', tool: 'gemini_api', voiceName: 'Puck' })
  const patch = (body: unknown) =>
    app.request(`/characters/${cat.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { app, cat, mine, foreign, patch, characters }
}

describe('PATCH /characters/:id（セリフの声と距離）', () => {
  it('同じ作品の声と距離を保存し、応答に返す。null で外せる', async () => {
    const f = await setup()
    const res = await f.patch({ dialogueVoiceProfileId: f.mine.id, dialogueLevelDb: -9.5 })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { dialogueVoiceProfileId: string | null; dialogueLevelDb: number } }
    expect(body.data).toMatchObject({ dialogueVoiceProfileId: f.mine.id, dialogueLevelDb: -9.5 })
    expect((await f.patch({ dialogueVoiceProfileId: null })).status).toBe(200)
    expect((await f.characters.findById(f.cat.id))?.dialogueVoiceProfileId).toBeNull()
  })

  it('別の作品の声・無い声は 422（欄の理由つき）。保存しない', async () => {
    const f = await setup()
    for (const id of [f.foreign.id, '01ARZ3NDEKTSV4RRFFQ69G5FAV']) {
      const res = await f.patch({ dialogueVoiceProfileId: id })
      expect(res.status).toBe(422)
      expect(((await res.json()) as { fields: Record<string, string[]> }).fields['dialogueVoiceProfileId']).toEqual([FOREIGN_DIALOGUE_VOICE_MESSAGE])
    }
    expect((await f.characters.findById(f.cat.id))?.dialogueVoiceProfileId).toBeNull()
  })

  it('声を確かめる口が無い環境では、セリフの声を選べない', async () => {
    const f = await setup({ withVoices: false })
    expect((await f.patch({ dialogueVoiceProfileId: f.mine.id })).status).toBe(422)
  })

  it('距離は -40〜12 dB。外れた値・数でない値は 422', async () => {
    const f = await setup()
    for (const value of [-40.5, 12.5, '3']) expect((await f.patch({ dialogueLevelDb: value })).status).toBe(422)
    expect((await f.patch({ dialogueLevelDb: -40 })).status).toBe(200)
    expect((await f.patch({ dialogueLevelDb: 12 })).status).toBe(200)
  })

  it('作るときにはセリフの声を受けない（作った後にその人の声から選ぶ）', async () => {
    const f = await setup()
    const res = await f.app.request(`/projects/${project.id}/characters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'nezumi', displayName: 'ネズミ', dialogueLevelDb: -3 }),
    })
    const body = (await res.json()) as { data?: { dialogueLevelDb: number } }
    expect(res.status).toBe(201)
    expect(body.data?.dialogueLevelDb).toBe(0)
  })
})
