import { OpenAPIHono } from '@hono/zod-openapi'
import { ProjectId as ProjectIdSchema, SequenceId as SequenceIdSchema, newId } from '@ixa/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { sequenceRoutes, type SequenceRoutesDeps } from '../routes/sequences.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import {
  createInMemorySequenceRepository,
  type InMemorySequenceRepository,
} from './in-memory-script-repositories.js'

type SuccessBody<T> = { success: true; data: T }
type ListBody<T> = { success: true; data: T[]; meta: { total: number } }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

type SequenceBody = {
  id: string
  projectId: string
  order: number
  name: string
  musicSectionLabel: string | null
  notes: string
}

const project = aProject()
const otherProject = aProject({ name: '別の Project' })

let sequences: InMemorySequenceRepository

const buildApp = (deps: SequenceRoutesDeps) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', sequenceRoutes(deps))
  registerErrorHandlers(app, createLogger('silent'))
  return app
}

let app: ReturnType<typeof buildApp>

const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

const createSequence = async (
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<SequenceBody> => {
  const res = await send('POST', `/projects/${projectId}/sequences`, {
    order: 0,
    name: 'Aメロ / 過去の回想',
    musicSectionLabel: null,
    ...overrides,
  })
  const body = await json<SuccessBody<SequenceBody>>(res)
  return body.data
}

beforeEach(() => {
  sequences = createInMemorySequenceRepository()
  app = buildApp({
    sequences,
    projects: createInMemoryProjectRepository([project, otherProject]),
  })
})

describe('Sequence の CRUD', () => {
  it('201 で作成し、経路の projectId が入る', async () => {
    const res = await send('POST', `/projects/${project.id}/sequences`, {
      order: 1,
      name: 'サビ',
      musicSectionLabel: 'chorus',
      notes: '全員が映る',
    })
    expect(res.status).toBe(201)
    const body = await json<SuccessBody<SequenceBody>>(res)
    expect(body.data.projectId).toBe(project.id)
    expect(body.data.musicSectionLabel).toBe('chorus')
    expect(body.data.notes).toBe('全員が映る')
  })

  it('一覧は order 昇順で返る（投入順に依らない）', async () => {
    await createSequence(project.id, { order: 2, name: 'サビ' })
    await createSequence(project.id, { order: 0, name: 'イントロ' })
    await createSequence(project.id, { order: 1, name: 'Aメロ' })

    const res = await send('GET', `/projects/${project.id}/sequences`)
    expect(res.status).toBe(200)
    const body = await json<ListBody<SequenceBody>>(res)
    expect(body.data.map((s) => s.name)).toEqual(['イントロ', 'Aメロ', 'サビ'])
    expect(body.meta.total).toBe(3)
  })

  it('他 Project の Sequence は混ざらない', async () => {
    await createSequence(project.id, { order: 0, name: '自分の' })
    await createSequence(otherProject.id, { order: 0, name: '他人の' })

    const res = await send('GET', `/projects/${project.id}/sequences`)
    const body = await json<ListBody<SequenceBody>>(res)
    expect(body.data.map((s) => s.name)).toEqual(['自分の'])
  })

  it('PATCH で部分更新でき、指定しなかった列は残る', async () => {
    const created = await createSequence(project.id, { notes: '元のメモ' })

    const res = await send('PATCH', `/sequences/${created.id}`, { order: 5, name: '大サビ' })
    expect(res.status).toBe(200)
    const body = await json<SuccessBody<SequenceBody>>(res)
    expect(body.data.order).toBe(5)
    expect(body.data.name).toBe('大サビ')
    expect(body.data.notes).toBe('元のメモ')
    expect(body.data.projectId).toBe(project.id)
  })

  it('DELETE は 204 を返し、一覧から消える', async () => {
    const created = await createSequence(project.id)

    const res = await send('DELETE', `/sequences/${created.id}`)
    expect(res.status).toBe(204)

    const list = await send('GET', `/projects/${project.id}/sequences`)
    const body = await json<ListBody<SequenceBody>>(list)
    expect(body.data).toEqual([])
  })
})

describe('存在しない対象', () => {
  it('存在しない Project の一覧・作成は 404', async () => {
    const ghost = newId(ProjectIdSchema)
    expect((await send('GET', `/projects/${ghost}/sequences`)).status).toBe(404)
    expect(
      (await send('POST', `/projects/${ghost}/sequences`, { order: 0, name: 'x' })).status,
    ).toBe(404)
  })

  it('存在しない Sequence の更新・削除は 404', async () => {
    const ghost = newId(SequenceIdSchema)
    expect((await send('PATCH', `/sequences/${ghost}`, { name: 'x' })).status).toBe(404)
    expect((await send('DELETE', `/sequences/${ghost}`)).status).toBe(404)
  })

  it('order が整数でなければ 422', async () => {
    const res = await send('POST', `/projects/${project.id}/sequences`, {
      order: 1.5,
      name: 'Aメロ',
    })
    expect(res.status).toBe(422)
    const body = await json<ErrorBody>(res)
    expect(body.fields?.order).toBeDefined()
  })
})
