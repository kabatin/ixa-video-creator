import {
  MediaAssetId as MediaAssetIdSchema,
  ProjectId as ProjectIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
} from '@ixa/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp, type AppDeps } from '../app.js'
import { INTERNAL_ERROR_MESSAGE } from '../errors.js'
import { createLogger } from '../logger.js'
import type { ProjectResponse } from '../routes/projects.js'
import { createMemoryStorage } from '@ixa/storage'
import { baseAppDeps } from './app-deps.js'
import { aMediaAsset } from './in-memory-timeline-repositories.js'
import { createInMemoryMediaAssetRepository } from '@ixa/generation/testing'
import {
  createFailingProjectRepository,
  createInMemoryProjectRepository,
  type InMemoryProjectRepository,
} from './in-memory-project-repository.js'

const logger = createLogger('silent')

const buildApp = (projects: AppDeps['projects']) =>
  createApp({
    ...baseAppDeps(),
    projects,
    mediaAssets: createInMemoryMediaAssetRepository(),
    storage: createMemoryStorage(),
    logger,
  })

const validBody = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: newId(WorkspaceIdSchema),
  name: 'iXA CUP MUSIC VIDEO',
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  ...overrides,
})

const postJson = (app: ReturnType<typeof buildApp>, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const patchJson = (app: ReturnType<typeof buildApp>, path: string, body: unknown) =>
  app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

type SuccessBody = { success: true; data: ProjectResponse }
type ListBody = { success: true; data: ProjectResponse[]; meta: { total: number } }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

describe('POST /projects', () => {
  let repo: InMemoryProjectRepository

  beforeEach(() => {
    repo = createInMemoryProjectRepository()
  })

  it('201 と作成されたプロジェクトを返す', async () => {
    const body = validBody()
    const res = await postJson(buildApp(repo), '/projects', body)

    expect(res.status).toBe(201)

    const json = (await res.json()) as SuccessBody
    expect(json.success).toBe(true)
    expect(json.data.name).toBe(body.name)
    expect(json.data.workspaceId).toBe(body.workspaceId)
    expect(json.data.fps).toBe(30)
    expect(json.data.status).toBe('planning')
    expect(ProjectIdSchema.safeParse(json.data.id).success).toBe(true)
    expect(repo.snapshot()).toHaveLength(1)
  })

  it('対応外の fps は 422 になり、エラーに fps が含まれる', async () => {
    const res = await postJson(buildApp(repo), '/projects', validBody({ fps: 48 }))

    expect(res.status).toBe(422)

    const json = (await res.json()) as ErrorBody
    expect(json.success).toBe(false)
    expect(Object.keys(json.fields ?? {})).toContain('fps')
    expect(repo.snapshot()).toHaveLength(0)
  })

  it('空の name は 422 になり、エラーに name が含まれる', async () => {
    const res = await postJson(buildApp(repo), '/projects', validBody({ name: '' }))

    expect(res.status).toBe(422)

    const json = (await res.json()) as ErrorBody
    expect(Object.keys(json.fields ?? {})).toContain('name')
  })

  it('複数の不正フィールドをまとめて報告する', async () => {
    const res = await postJson(buildApp(repo), '/projects', validBody({ name: '', fps: 48 }))

    expect(res.status).toBe(422)

    const json = (await res.json()) as ErrorBody
    expect(Object.keys(json.fields ?? {}).sort()).toEqual(['fps', 'name'])
  })
})

describe('GET /projects', () => {
  it('workspaceId で絞り込む', async () => {
    const repo = createInMemoryProjectRepository()
    const app = buildApp(repo)

    const workspaceA = newId(WorkspaceIdSchema)
    const workspaceB = newId(WorkspaceIdSchema)

    await postJson(app, '/projects', validBody({ workspaceId: workspaceA, name: 'A-1' }))
    await postJson(app, '/projects', validBody({ workspaceId: workspaceA, name: 'A-2' }))
    await postJson(app, '/projects', validBody({ workspaceId: workspaceB, name: 'B-1' }))

    const res = await app.request(`/projects?workspaceId=${workspaceA}`)
    expect(res.status).toBe(200)

    const json = (await res.json()) as ListBody
    expect(json.meta.total).toBe(2)
    expect(json.data.map((p) => p.name).sort()).toEqual(['A-1', 'A-2'])
  })

  it('workspaceId がなければ 422', async () => {
    const res = await buildApp(createInMemoryProjectRepository()).request('/projects')

    expect(res.status).toBe(422)

    const json = (await res.json()) as ErrorBody
    expect(Object.keys(json.fields ?? {})).toContain('workspaceId')
  })
})

describe('GET /projects/:id', () => {
  it('存在しない id は 404', async () => {
    const res = await buildApp(createInMemoryProjectRepository()).request(
      `/projects/${newId(ProjectIdSchema)}`,
    )

    expect(res.status).toBe(404)
    expect(((await res.json()) as ErrorBody).success).toBe(false)
  })

  it('作成したプロジェクトを取得できる', async () => {
    const app = buildApp(createInMemoryProjectRepository())
    const created = (await (await postJson(app, '/projects', validBody())).json()) as SuccessBody

    const res = await app.request(`/projects/${created.data.id}`)

    expect(res.status).toBe(200)
    expect(((await res.json()) as SuccessBody).data).toEqual(created.data)
  })
})

describe('PATCH /projects/:id', () => {
  it('部分更新ができ、指定しなかった列は変わらない', async () => {
    const app = buildApp(createInMemoryProjectRepository())
    const created = (await (await postJson(app, '/projects', validBody())).json()) as SuccessBody

    const res = await patchJson(app, `/projects/${created.data.id}`, {
      name: '改題したプロジェクト',
      status: 'production',
    })

    expect(res.status).toBe(200)

    const json = (await res.json()) as SuccessBody
    expect(json.data.name).toBe('改題したプロジェクト')
    expect(json.data.status).toBe('production')
    expect(json.data.fps).toBe(created.data.fps)
    expect(json.data.resolution).toEqual(created.data.resolution)
    expect(json.data.id).toBe(created.data.id)
  })

  it('不正な status は 422', async () => {
    const app = buildApp(createInMemoryProjectRepository())
    const created = (await (await postJson(app, '/projects', validBody())).json()) as SuccessBody

    const res = await patchJson(app, `/projects/${created.data.id}`, { status: 'shipped' })

    expect(res.status).toBe(422)
    expect(Object.keys(((await res.json()) as ErrorBody).fields ?? {})).toContain('status')
  })

  it('存在しない id は 404', async () => {
    const res = await patchJson(
      buildApp(createInMemoryProjectRepository()),
      `/projects/${newId(ProjectIdSchema)}`,
      { name: '存在しない' },
    )

    expect(res.status).toBe(404)
  })
})

describe('DELETE /projects/:id', () => {
  it('204 を返し、以後 404 になる', async () => {
    const app = buildApp(createInMemoryProjectRepository())
    const created = (await (await postJson(app, '/projects', validBody())).json()) as SuccessBody

    const res = await app.request(`/projects/${created.data.id}`, { method: 'DELETE' })

    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')

    const after = await app.request(`/projects/${created.data.id}`)
    expect(after.status).toBe(404)
  })

  it('存在しない id は 404', async () => {
    const res = await buildApp(createInMemoryProjectRepository()).request(
      `/projects/${newId(ProjectIdSchema)}`,
      { method: 'DELETE' },
    )

    expect(res.status).toBe(404)
  })
})

describe('500 応答', () => {
  const secret = 'postgres://admin:hunter2@db.internal:5432/ixa'
  const internalError = new Error(`connection refused: ${secret}`)

  it('内部エラーの詳細（メッセージ / スタック）を漏らさない', async () => {
    const app = buildApp(createFailingProjectRepository(internalError))

    const res = await postJson(app, '/projects', validBody())
    expect(res.status).toBe(500)

    const text = await res.text()
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('postgres://')
    expect(text).not.toContain('connection refused')
    expect(text).not.toContain('at ')

    const json = JSON.parse(text) as ErrorBody
    expect(json).toEqual({ success: false, error: INTERNAL_ERROR_MESSAGE })
  })
})

/**
 * 作品の方針（ADR-0030）。ルック・避けたいもの・手本画像は Project の部分更新で保存する。
 * 手本画像は**画像・同じワークスペース・3 枚まで**。外れれば何も変えずに 422。
 */
describe('PATCH /projects/:id — 作品の方針', () => {
  const workspaceId = newId(WorkspaceIdSchema)
  const image = aMediaAsset({ workspaceId, kind: 'image', mimeType: 'image/png', storageKey: 'media/ws/a/original.png' })
  const video = aMediaAsset({ workspaceId, kind: 'video' })
  const foreign = aMediaAsset({ workspaceId: newId(WorkspaceIdSchema), kind: 'image', mimeType: 'image/png' })

  const setup = async () => {
    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository(),
      mediaAssets: createInMemoryMediaAssetRepository([image, video, foreign]),
      storage: createMemoryStorage(),
      logger: createLogger('silent'),
    })
    const created = (await (await postJson(app, '/projects', validBody({ workspaceId }))).json()) as SuccessBody
    return { app, id: created.data.id }
  }

  it('ルック・避けたいもの・手本画像を保存する', async () => {
    const { app, id } = await setup()

    const res = await patchJson(app, `/projects/${id}`, {
      styleGuide: '35mm フィルム、夜の雨',
      avoid: '文字、透かし',
      styleReferenceAssetIds: [image.id],
    })

    expect(res.status).toBe(200)
    expect(((await res.json()) as SuccessBody).data).toMatchObject({
      styleGuide: '35mm フィルム、夜の雨',
      avoid: '文字、透かし',
      styleReferenceAssetIds: [image.id],
    })
  })

  it.each([
    ['画像でない', () => [video.id]],
    ['別のワークスペース', () => [foreign.id]],
    ['見つからない', () => [newId(MediaAssetIdSchema)]],
    ['同じ画像が 2 回', () => [image.id, image.id]],
  ])('手本画像が%sなら 422（何も変えない）', async (_label, ids) => {
    const { app, id } = await setup()

    const res = await patchJson(app, `/projects/${id}`, { avoid: '文字', styleReferenceAssetIds: ids() })

    expect(res.status).toBe(422)
    expect(((await res.json()) as ErrorBody).fields?.styleReferenceAssetIds).toBeDefined()
    const after = (await (await app.request(`/projects/${id}`)).json()) as SuccessBody
    expect(after.data.avoid).toBe('')
  })

  it('手本画像は 3 枚まで', async () => {
    const { app, id } = await setup()

    const res = await patchJson(app, `/projects/${id}`, { styleReferenceAssetIds: [image.id, image.id, image.id, image.id] })

    expect(res.status).toBe(422)
  })
})

/**
 * 歌詞（ADR-0033）。1 行 = 1 フレーズと、行ごとの歌い出しの秒（前から順に付ける）。
 * 時刻は行の順に後ろへ進む 0 以上の秒だけ。歌詞の行が減ったら、時刻もそこまでに切り詰める。
 */
describe('PATCH /projects/:id — 歌詞', () => {
  const setup = async () => {
    const app = createApp({
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository(),
      logger: createLogger('silent'),
    })
    const created = (await (await postJson(app, '/projects', validBody())).json()) as SuccessBody
    return { app, id: created.data.id }
  }
  const read = async (app: ReturnType<typeof createApp>, id: string) =>
    ((await (await app.request(`/projects/${id}`)).json()) as SuccessBody).data as unknown as {
      lyrics: string
      lyricCues: number[]
    }

  it('歌詞と時刻を保存する', async () => {
    const { app, id } = await setup()

    const res = await patchJson(app, `/projects/${id}`, { lyrics: '一行目\n二行目', lyricCues: [1.5, 3.25] })

    expect(res.status).toBe(200)
    expect(await read(app, id)).toMatchObject({ lyrics: '一行目\n二行目', lyricCues: [1.5, 3.25] })
  })

  it.each([
    ['戻る', [3, 1]],
    ['負', [-1]],
    ['行より多い', [1, 2, 3]],
  ])('時刻が%sなら 422（何も変えない）', async (_label, cues) => {
    const { app, id } = await setup()

    const res = await patchJson(app, `/projects/${id}`, { lyrics: '一行目\n二行目', lyricCues: cues })

    expect(res.status).toBe(422)
    // 負の秒はスキーマが弾く（欄の名前は lyricCues.0）。並びと数はこの口が弾く。
    const fields = Object.keys(((await res.json()) as ErrorBody).fields ?? {})
    expect(fields.some((field) => field.startsWith('lyricCues'))).toBe(true)
    expect((await read(app, id)).lyrics).toBe('')
  })

  it('歌詞の行が減ったら、時刻もそこまでに切り詰める', async () => {
    const { app, id } = await setup()
    await patchJson(app, `/projects/${id}`, { lyrics: '一\n二\n三', lyricCues: [1, 2, 3] })

    await patchJson(app, `/projects/${id}`, { lyrics: '一\n二' })

    expect((await read(app, id)).lyricCues).toEqual([1, 2])
  })
})
