import { ProjectId as ProjectIdSchema, WorkspaceId as WorkspaceIdSchema, newId } from '@ixa/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp, type AppDeps } from '../app.js'
import { INTERNAL_ERROR_MESSAGE } from '../errors.js'
import { createLogger } from '../logger.js'
import type { ProjectResponse } from '../routes/projects.js'
import { createMemoryStorage } from '@ixa/storage'
import { baseAppDeps } from './app-deps.js'
import { createInMemoryMediaAssetRepository } from './in-memory-media-asset-repository.js'
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
