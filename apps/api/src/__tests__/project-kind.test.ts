import { WorkspaceId as WorkspaceIdSchema, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import type { EditBatchSummaryResponse, UndoEditBatchResponse } from '../routes/edit-batches.js'
import type { ProjectResponse } from '../routes/projects.js'
import { baseAppDeps, createTestApp } from './app-deps.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 作品の種類（何を作るか）と見本の印（demoKey）の HTTP の口。
 * 種類は作るとき・直すときに送れる。**見本の印はどちらの口からも付けられない**（任意の作品を見本にさせない）。
 */

type Ok<T> = { success: true; data: T }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

const build = () => {
  const projects = createInMemoryProjectRepository()
  const editBatches = createInMemoryEditBatchRepository()
  const app = createTestApp({ ...baseAppDeps(), projects, editBatches })
  const send = (method: 'POST' | 'PATCH', path: string, body: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const create = (overrides: Record<string, unknown> = {}) =>
    send('POST', '/projects', {
      workspaceId: newId(WorkspaceIdSchema),
      name: '作品',
      fps: 30,
      resolution: { width: 1920, height: 1080 },
      aspectRatio: '16:9',
      ...overrides,
    })
  const created = async (overrides: Record<string, unknown> = {}): Promise<ProjectResponse> => {
    const res = await create(overrides)
    expect(res.status).toBe(201)
    return ((await res.json()) as Ok<ProjectResponse>).data
  }
  return { app, projects, send, create, created }
}

describe('POST /projects の種類', () => {
  it('送らなければミュージックビデオ、送れば選んだ種類。見本の印は無し', async () => {
    const f = build()
    expect(await f.created()).toMatchObject({ kind: 'mv', demoKey: null })
    expect(await f.created({ kind: 'kamishibai' })).toMatchObject({ kind: 'kamishibai', demoKey: null })
  })

  it('知らない種類は 422 で、エラーに kind が含まれる', async () => {
    const res = await build().create({ kind: 'anime' })
    expect(res.status).toBe(422)
    expect(Object.keys(((await res.json()) as ErrorBody).fields ?? {})).toContain('kind')
  })

  it('見本の印を送っても付かない', async () => {
    const f = build()
    const project = await f.created({ demoKey: 'ixa-demo-v1' })
    expect(project.demoKey).toBeNull()
    expect(await f.projects.findByDemoKey(project.workspaceId, 'ixa-demo-v1')).toBeNull()
  })
})

describe('PATCH /projects/:id の種類', () => {
  it('種類を変えられる。ほかの欄だけ直しても種類は変わらない', async () => {
    const f = build()
    const project = await f.created({ kind: 'short' })
    const renamed = await f.send('PATCH', `/projects/${project.id}`, { name: '改名' })
    expect(((await renamed.json()) as Ok<ProjectResponse>).data.kind).toBe('short')
    const changed = await f.send('PATCH', `/projects/${project.id}`, { kind: 'library' })
    expect(changed.status).toBe(200)
    expect(((await changed.json()) as Ok<ProjectResponse>).data.kind).toBe('library')
  })

  it('知らない種類は 422', async () => {
    const f = build()
    const project = await f.created()
    const res = await f.send('PATCH', `/projects/${project.id}`, { kind: 'anime' })
    expect(res.status).toBe(422)
    expect(Object.keys(((await res.json()) as ErrorBody).fields ?? {})).toContain('kind')
  })

  it('見本の印を送っても付かない', async () => {
    const f = build()
    const project = await f.created()
    const res = await f.send('PATCH', `/projects/${project.id}`, { name: '改名', demoKey: 'ixa-demo-v1' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Ok<ProjectResponse>).data).toMatchObject({ name: '改名', demoKey: null })
  })

  it('見本の作品の印は、直しても消えない', async () => {
    const seeded = aProject({ kind: 'mv' })
    const projects = createInMemoryProjectRepository([{ ...seeded, demoKey: 'ixa-demo-v1' }])
    const app = createTestApp({ ...baseAppDeps(), projects, editBatches: createInMemoryEditBatchRepository() })
    const res = await app.request(`/projects/${seeded.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'short', demoKey: null }),
    })
    expect(((await res.json()) as Ok<ProjectResponse>).data).toMatchObject({ kind: 'short', demoKey: 'ixa-demo-v1' })
  })
})

describe('種類の直しの取り消し', () => {
  it('種類を変えると記録が残り、戻すと前の種類に戻る', async () => {
    const f = build()
    const project = await f.created({ kind: 'short' })
    expect((await f.send('PATCH', `/projects/${project.id}`, { kind: 'cm' })).status).toBe(200)
    const batches = (await (await f.app.request(`/projects/${project.id}/edit-batches`)).json()) as { data: EditBatchSummaryResponse[] }
    const batch = batches.data[0]
    expect(batch).toMatchObject({ kind: 'project_edit', canUndo: true })

    const res = await f.app.request(`/projects/${project.id}/edit-batches/${batch!.id}/undo`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Ok<UndoEditBatchResponse>).data.restoredProject).toBe(true)
    expect((await f.projects.findById(project.id))?.kind).toBe('short')
  })
})
