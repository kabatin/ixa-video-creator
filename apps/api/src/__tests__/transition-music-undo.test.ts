import { OpenAPIHono } from '@hono/zod-openapi'
import { MusicTrack, MusicTrackId, newId, type Transition } from '@ixa/domain'
import { aShot, createInMemoryShotRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { editBatchRoutes, type EditBatchSummaryResponse, type UndoEditBatchResponse } from '../routes/edit-batches.js'
import { musicEditRoutes } from '../routes/music-edit.js'
import { transitionRoutes } from '../routes/transitions.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import {
  createInMemoryMusicTrackRepository,
  createInMemoryTimelineClipRepository,
  createInMemoryTransitionRepository,
} from './in-memory-timeline-repositories.js'

/**
 * トランジションの置く・消す・差し替えと、楽曲の欄の直し・マスターの切り替えを取り消す（2026-10-19 の見直し）。
 * どれも記録が無く、⌘Z で戻らなかった（トランジションは物理削除で、消したら二度と戻らなかった）。
 */

type Ok<T> = { success: true; data: T }

const project = aProject()
const shotA = aShot(project.id, { order: 0, code: 'A-01', startSec: 0, durationSec: 4 })
const shotB = aShot(project.id, { order: 1, code: 'A-02', startSec: 4, durationSec: 4 })

const track = (overrides: Partial<MusicTrack>): MusicTrack =>
  MusicTrack.parse({
    id: newId(MusicTrackId),
    projectId: project.id,
    mediaAssetId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    title: '曲',
    isMaster: false,
    offsetSec: 0,
    volume: 1,
    ...overrides,
  })

const build = (tracks: readonly MusicTrack[] = []) => {
  const transitions = createInMemoryTransitionRepository()
  const musicTracks = createInMemoryMusicTrackRepository(tracks)
  const shots = createInMemoryShotRepository([shotA, shotB])
  const editBatches = createInMemoryEditBatchRepository()
  const projects = createInMemoryProjectRepository([project])
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', transitionRoutes({ transitions, shots, projects, editBatches }))
  app.route('/', musicEditRoutes({ musicTracks, editBatches }))
  app.route(
    '/',
    editBatchRoutes({ projects, shots, editBatches, timelineClips: createInMemoryTimelineClipRepository(), transitions, musicTracks }),
  )
  registerErrorHandlers(app, createLogger('silent'))
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const latest = async (): Promise<EditBatchSummaryResponse | undefined> =>
    ((await (await app.request(`/projects/${project.id}/edit-batches`)).json()) as { data: EditBatchSummaryResponse[] }).data[0]
  const undo = async (id: string): Promise<UndoEditBatchResponse> => {
    const res = await send('POST', `/projects/${project.id}/edit-batches/${id}/undo`)
    expect(res.status).toBe(200)
    return ((await res.json()) as Ok<UndoEditBatchResponse>).data
  }
  const place = async (body: Record<string, unknown> = {}): Promise<Transition> => {
    const res = await send('POST', `/projects/${project.id}/transitions`, {
      fromShotId: shotA.id,
      toShotId: shotB.id,
      type: 'dissolve',
      durationSec: 0.5,
      ...body,
    })
    expect(res.status).toBe(201)
    return ((await res.json()) as Ok<Transition>).data
  }
  return { transitions, musicTracks, send, latest, undo, place }
}

describe('トランジション', () => {
  it('置くと記録が残り、戻すと消える', async () => {
    const f = build()
    const placed = await f.place()
    const batch = await f.latest()
    expect(batch).toMatchObject({ kind: 'transition_edit', summary: 'トランジションを置く', transitionCount: 1 })

    const result = await f.undo(batch!.id)
    expect(result.restoredTransitions).toEqual([placed.id])
    expect(f.transitions.snapshot()).toEqual([])
  })

  it('消すと記録が残り、戻すと同じ ID・同じ中身で戻る', async () => {
    const f = build()
    const placed = await f.place()
    expect((await f.send('DELETE', `/transitions/${placed.id}`)).status).toBe(204)
    const batch = await f.latest()
    expect(batch?.summary).toBe('トランジションを消す')

    await f.undo(batch!.id)
    expect(f.transitions.snapshot()).toEqual([placed])
  })

  it('差し替えは 1 つの記録になり、戻すと前のトランジションが同じ ID で戻る', async () => {
    const f = build()
    const placed = await f.place()
    const replaced = await f.place({ type: 'dip_to_black', durationSec: 1, replaceTransitionId: placed.id })
    expect(f.transitions.snapshot()).toEqual([replaced])
    const batch = await f.latest()
    expect(batch).toMatchObject({ summary: 'トランジションを差し替える', transitionCount: 2 })

    await f.undo(batch!.id)
    expect(f.transitions.snapshot()).toEqual([placed])
  })

  it('差し替える相手が別の組なら断り、何も変えず記録もしない', async () => {
    const f = build()
    const placed = await f.place()
    const before = await f.latest()
    const res = await f.send('POST', `/projects/${project.id}/transitions`, {
      fromShotId: shotB.id,
      toShotId: shotA.id,
      type: 'cut',
      replaceTransitionId: placed.id,
    })
    expect(res.status).toBe(422)
    expect(f.transitions.snapshot()).toEqual([placed])
    expect(await f.latest()).toEqual(before)
  })

  it('戻す前に同じ組へ別のトランジションが置かれていたら、理由つきで戻せなかったと返す', async () => {
    const f = build()
    const placed = await f.place()
    await f.send('DELETE', `/transitions/${placed.id}`)
    const removed = await f.latest()
    await f.place({ type: 'cut' })

    const result = await f.undo(removed!.id)
    expect(result.restoredTransitions).toEqual([])
    expect(result.failedTransitions.map((entry) => entry.transitionId)).toEqual([placed.id])
  })
})

describe('楽曲', () => {
  it('欄を直すと変えた欄だけが記録され、戻すとその欄だけが元に戻る', async () => {
    const song = track({ title: '前の題', volume: 1, fadeInSec: 0 })
    const f = build([song])

    expect((await f.send('PATCH', `/music-tracks/${song.id}`, { title: '新しい題', volume: 0.5, fadeInSec: 0 })).status).toBe(200)
    const batch = await f.latest()
    expect(batch).toMatchObject({ kind: 'music_edit', summary: '曲「前の題」を直す', musicCount: 1 })

    await f.send('PATCH', `/music-tracks/${song.id}`, { offsetSec: 2 })
    await f.undo(batch!.id)
    expect(await f.musicTracks.findById(song.id)).toMatchObject({ title: '前の題', volume: 1, offsetSec: 2 })
  })

  it('何も変わらない直しは記録しない', async () => {
    const song = track({ volume: 1 })
    const f = build([song])
    await f.send('PATCH', `/music-tracks/${song.id}`, { volume: 1 })
    expect(await f.latest()).toBeUndefined()
  })

  it('マスターを切り替えると記録が残り、戻すと前のマスターに戻る', async () => {
    const first = track({ title: '1 曲目', isMaster: true })
    const second = track({ title: '2 曲目' })
    const f = build([first, second])

    expect((await f.send('POST', `/music-tracks/${second.id}/set-master`)).status).toBe(200)
    const batch = await f.latest()
    expect(batch?.summary).toBe('マスターを「2 曲目」にする')

    await f.undo(batch!.id)
    expect((await f.musicTracks.findById(first.id))?.isMaster).toBe(true)
    expect((await f.musicTracks.findById(second.id))?.isMaster).toBe(false)
  })

  it('もうマスターの曲をマスターにしても記録しない', async () => {
    const first = track({ isMaster: true })
    const f = build([first])
    await f.send('POST', `/music-tracks/${first.id}/set-master`)
    expect(await f.latest()).toBeUndefined()
  })
})
