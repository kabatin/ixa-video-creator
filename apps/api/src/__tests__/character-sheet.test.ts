import { OpenAPIHono } from '@hono/zod-openapi'
import {
  CharacterId as CharacterIdSchema,
  CharacterIdentityImageId as CharacterIdentityImageIdSchema,
  MediaAssetId as MediaAssetIdSchema,
  ModelId,
  ProviderId,
  newId,
  type ImageGenerationJobId,
  type ProjectEvent,
} from '@ixa/domain'
import { createInMemoryCharacterRepository, createInMemoryImageJobRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { characterSheetRoutes } from '../routes/character-sheet.js'
import { aProject } from './fixtures.js'

/**
 * 1 枚の画像からキャラクターシート（四面図）を作る口（ADR-0035。制作者 2026-10-03「動画生成に役立つ形式の
 * キャラクターシートを 1 枚の画像から作れるといい。正面などの画像を用意したら、それを基に Codex CLI で作る」）。
 * ジョブを 1 行作って image キューへ入れるだけ（絵コンテの画像と同じ順番待ち）。作るのは worker。
 */

type Ok<T> = { success: true; data: T }
type Err = { success: false; error: string; fields?: Record<string, string[]> }
type SheetState = { job: { id: string; status: string; error: string | null } | null }

const project = aProject()
const CODEX = { providerId: ProviderId.parse('codex-cli'), modelId: ModelId.parse('codex-cli/image-gen') }

const build = async (options: { failEnqueue?: boolean; images?: 'none' | 'front' | 'sheet-only' } = {}) => {
  const characters = createInMemoryCharacterRepository()
  const character = await characters.create({
    workspaceId: project.workspaceId,
    projectId: project.id,
    name: 'takepi',
    displayName: '藤本タケピ',
  })
  const front = newId(MediaAssetIdSchema)
  const side = newId(MediaAssetIdSchema)
  if (options.images !== 'none') {
    if (options.images !== 'sheet-only') {
      await characters.addIdentityImage({ characterId: character.id, mediaAssetId: side, role: 'face_side', isPrimary: false, order: 0 })
      await characters.addIdentityImage({ characterId: character.id, mediaAssetId: front, role: 'full_body', isPrimary: true, order: 1 })
    }
    await characters.addIdentityImage({
      characterId: character.id, mediaAssetId: newId(MediaAssetIdSchema), role: 'four_view', isPrimary: true, order: 2,
    })
  }
  const enqueued: ImageGenerationJobId[] = []
  const published: ProjectEvent[] = []
  const imageJobs = createInMemoryImageJobRepository()
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    characterSheetRoutes({
      characters,
      imageJobs,
      imageQueue: {
        enqueue: (id: ImageGenerationJobId) =>
          options.failEnqueue === true ? Promise.reject(new Error('Redis に繋がりません')) : Promise.resolve(void enqueued.push(id)),
      },
      imageModel: () => Promise.resolve(CODEX),
      events: { publish: (event: ProjectEvent) => Promise.resolve(void published.push(event)) },
      logger: createLogger('silent'),
    }),
  )
  const request = (method: string, body?: unknown, id: string = character.id) =>
    app.request(`/characters/${id}/character-sheet`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  return { character, characters, imageJobs, enqueued, published, request, front, side }
}

describe('POST /characters/{id}/character-sheet', () => {
  it('手本（四面図以外の主の画像）を決めてジョブを作り、キューへ入れる。出来事にキャラクターが乗る', async () => {
    const f = await build()

    const res = await f.request('POST', {})

    expect(res.status).toBe(202)
    const [job] = f.imageJobs.snapshot()
    expect(job).toMatchObject({
      kind: 'character_sheet',
      characterId: f.character.id,
      shotId: null,
      projectId: project.id,
      referenceAssetIds: [f.front],
      ...CODEX,
    })
    expect(f.enqueued).toEqual([job?.id])
    expect(f.published[0]).toMatchObject({ type: 'image_job.status', characterId: f.character.id, shotId: null })
  })

  it('手本を指定できる。四面図や別の画像の指定は 422', async () => {
    const f = await build()
    const images = await f.characters.listIdentityImages(f.character.id)
    const side = images.find((image) => image.role === 'face_side')
    const sheet = images.find((image) => image.role === 'four_view')

    expect((await f.request('POST', { referenceIdentityImageId: side?.id })).status).toBe(202)
    expect(f.imageJobs.snapshot()[0]?.referenceAssetIds).toEqual([f.side])

    const g = await build()
    expect((await g.request('POST', { referenceIdentityImageId: sheet?.id })).status).toBe(422)
    expect((await g.request('POST', { referenceIdentityImageId: newId(CharacterIdentityImageIdSchema) })).status).toBe(422)
  })

  it('手本の画像が無い（四面図しか無い）なら 422 で理由を返し、ジョブを作らない', async () => {
    for (const images of ['none', 'sheet-only'] as const) {
      const f = await build({ images })
      const res = await f.request('POST', {})
      expect(res.status).toBe(422)
      expect(((await res.json()) as Err).fields?.referenceIdentityImageId?.[0]).toMatch(/正面などの画像/)
      expect(f.imageJobs.snapshot()).toEqual([])
    }
  })

  it('作っている最中は 409。無いキャラクターは 404', async () => {
    const f = await build()
    expect((await f.request('POST', {})).status).toBe(202)
    expect((await f.request('POST', {})).status).toBe(409)
    expect((await f.request('POST', {}, newId(CharacterIdSchema))).status).toBe(404)
  })

  it('キューへ入れられなければ失敗にして 500（「作っています」のまま残さない）', async () => {
    const f = await build({ failEnqueue: true })

    expect((await f.request('POST', {})).status).toBe(500)
    expect(f.imageJobs.snapshot()[0]?.status).toBe('failed')
  })
})

describe('GET /characters/{id}/character-sheet', () => {
  it('最新のジョブの状態を返す（読み直しても「作っています」を出せる）。まだ無ければ null', async () => {
    const f = await build()
    expect(((await (await f.request('GET')).json()) as Ok<SheetState>).data.job).toBeNull()

    await f.request('POST', {})
    const state = ((await (await f.request('GET')).json()) as Ok<SheetState>).data

    expect(state.job).toMatchObject({ status: 'queued', error: null })
  })
})
