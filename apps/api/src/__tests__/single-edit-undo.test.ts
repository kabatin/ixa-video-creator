import { OpenAPIHono } from '@hono/zod-openapi'
import type { Shot } from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryCharacterRepository,
  createInMemoryLocationRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { editBatchRoutes, type EditBatchSummaryResponse } from '../routes/edit-batches.js'
import { shotSingleEditRoutes } from '../routes/shot-single-edits.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryEditTransaction } from './in-memory-edit-transaction.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * Shot 1 件の直し・採用 Take の 1 件の決定と外しを取り消す（2026-10-19 の見直し）。
 * これまで記録が残るのは一括操作だけで、1 件ずつ直した Shot は ⌘Z で戻らなかった。
 * 記録の形は一括と同じ（変えた欄の、変える前の値）。
 */

const project = aProject()

const build = (shots: readonly Shot[], takes = createInMemoryTakeRepository()) => {
  const shotRepo = createInMemoryShotRepository(shots)
  const editBatches = createInMemoryEditBatchRepository()
  const projects = createInMemoryProjectRepository([project])
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    shotSingleEditRoutes({
      shots: shotRepo,
      locations: createInMemoryLocationRepository(),
      characters: createInMemoryCharacterRepository(),
      takes,
      events: createInMemoryProjectEvents(),
      logger: createLogger('silent'),
      transaction: createInMemoryEditTransaction({ editBatches, shots: shotRepo }),
    }),
  )
  app.route('/', editBatchRoutes({ projects, shots: shotRepo, editBatches, timelineClips: unusedClips }))
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const latest = async (): Promise<EditBatchSummaryResponse | undefined> => {
    const res = await app.request(`/projects/${project.id}/edit-batches`)
    return ((await res.json()) as { data: EditBatchSummaryResponse[] }).data[0]
  }
  const undo = (id: string) => send('POST', `/projects/${project.id}/edit-batches/${id}/undo`)
  return { shots: shotRepo, send, latest, undo }
}

const unusedClips = {
  findByProject: () => Promise.reject(new Error('呼ばれない')),
  findById: () => Promise.reject(new Error('呼ばれない')),
  update: () => Promise.reject(new Error('呼ばれない')),
  softDelete: () => Promise.reject(new Error('呼ばれない')),
  restore: () => Promise.reject(new Error('呼ばれない')),
}

describe('Shot 1 件を直す', () => {
  it('記録が残り、戻すと変えた欄だけが元に戻る', async () => {
    const shot = aShot(project.id, { code: 'CUT-03', description: '夕焼け', durationSec: 4 })
    const f = build([shot])

    expect((await f.send('PATCH', `/shots/${shot.id}`, { description: '朝焼け', durationSec: 3 })).status).toBe(200)
    const batch = await f.latest()
    expect(batch).toMatchObject({ kind: 'shot_edit', summary: 'CUT-03 を直す', shotCount: 1, canUndo: true })

    expect((await f.undo(batch!.id)).status).toBe(200)
    const restored = await f.shots.findById(shot.id)
    expect(restored).toMatchObject({ description: '夕焼け', durationSec: 4 })
  })

  it('何も変わらない直しは記録しない', async () => {
    const shot = aShot(project.id, { description: '夕焼け' })
    const f = build([shot])
    await f.send('PATCH', `/shots/${shot.id}`, { description: '夕焼け' })
    expect(await f.latest()).toBeUndefined()
  })

  it('無い Shot は 404 で、記録しない', async () => {
    const f = build([])
    expect((await f.send('PATCH', '/shots/01ARZ3NDEKTSV4RRFFQ69G5FAV', { description: 'x' })).status).toBe(404)
    expect(await f.latest()).toBeUndefined()
  })
})

describe('採用 Take を 1 件ずつ決める・外す', () => {
  it('決めると記録が残り、戻すと採用と状態が前に戻る', async () => {
    const shot = aShot(project.id, { code: 'CUT-01', status: 'review', selectedTakeId: null })
    const take = aTake(shot, 'a'.repeat(64))
    const f = build([shot], createInMemoryTakeRepository([take]))

    expect((await f.send('POST', `/shots/${shot.id}/select-take`, { takeId: take.id })).status).toBe(200)
    expect((await f.shots.findById(shot.id))?.selectedTakeId).toBe(take.id)
    const batch = await f.latest()
    expect(batch).toMatchObject({ kind: 'shot_edit', summary: 'CUT-01 の採用 Take を決める' })

    await f.undo(batch!.id)
    expect(await f.shots.findById(shot.id)).toMatchObject({ selectedTakeId: null, status: 'review' })
  })

  it('外すと記録が残り、戻すとまた採用される', async () => {
    const base = aShot(project.id, { code: 'CUT-02', status: 'approved' })
    const take = aTake(base, 'a'.repeat(64))
    const shot = { ...base, selectedTakeId: take.id }
    const f = build([shot], createInMemoryTakeRepository([take]))

    expect((await f.send('DELETE', `/shots/${shot.id}/selected-take`)).status).toBe(200)
    const batch = await f.latest()
    expect(batch?.summary).toBe('CUT-02 の採用を外す')

    await f.undo(batch!.id)
    expect(await f.shots.findById(shot.id)).toMatchObject({ selectedTakeId: take.id, status: 'approved' })
  })

  it('採用していない Shot の「外す」は記録しない', async () => {
    const shot = aShot(project.id, { selectedTakeId: null })
    const f = build([shot])
    await f.send('DELETE', `/shots/${shot.id}/selected-take`)
    expect(await f.latest()).toBeUndefined()
  })
})
