import { OpenAPIHono } from '@hono/zod-openapi'
import type { EditTransaction } from '@ixa/db'
import { MusicTrack, MusicTrackId, TimelineClip, TimelineClipId, newId, type Shot } from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryCharacterRepository,
  createInMemoryLocationRepository,
  createInMemoryMediaAssetRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { clipSpanRoutes } from '../routes/clip-spans.js'
import { clipRoutes } from '../routes/clips.js'
import { musicEditRoutes } from '../routes/music-edit.js'
import { shotSingleEditRoutes } from '../routes/shot-single-edits.js'
import { transitionRoutes } from '../routes/transitions.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createFailingRecordTransaction, createInMemoryEditTransaction } from './in-memory-edit-transaction.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import {
  createInMemoryMusicTrackRepository,
  createInMemoryTimelineClipRepository,
  createInMemoryTransitionRepository,
} from './in-memory-timeline-repositories.js'
import { setupNarration } from './narration-fixture.js'

/**
 * 取り消しの記録と書き込みは**同じトランザクション**で、**記録を先に**作る（2026-10-19 のレビュー）。
 *
 * 経路ごとに 2 つを確かめる。
 * 1. 記録が作れなければ書き込まない（書き込みだけが残ると戻せない）
 * 2. 書き込みが落ちれば記録が残らない（記録だけが残ると ⌘Z が空振りし、1 つ前が戻らない）
 */

const project = aProject()
const reject = (): Promise<never> => Promise.reject(new Error('書き込みに失敗しました'))

type Mode = 'record-fails' | 'write-fails' | 'ok'

const app = (mount: (app: OpenAPIHono) => void): OpenAPIHono => {
  const built = new OpenAPIHono({ defaultHook: validationHook })
  mount(built)
  registerErrorHandlers(built, createLogger('silent'))
  return built
}

const send = (target: OpenAPIHono, method: string, path: string, body?: unknown) =>
  target.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const aText = (startSec: number): TimelineClip =>
  TimelineClip.parse({
    id: newId(TimelineClipId),
    projectId: project.id,
    track: 'TEXT',
    startSec,
    durationSec: 2,
    layer: 0,
    content: { type: 'text', templateKey: 'plain', params: { text: 'あ' } },
    opacity: 1,
    createdAt: new Date(),
  })

describe('クリップ', () => {
  const build = (mode: Mode) => {
    const first = aText(0)
    const second = aText(2)
    const clips = createInMemoryTimelineClipRepository([first, second])
    const editBatches = createInMemoryEditBatchRepository()
    const projects = createInMemoryProjectRepository([project])
    const failingWrites = { ...clips, create: reject, update: reject, softDelete: reject }
    const transaction: EditTransaction =
      mode === 'record-fails'
        ? createFailingRecordTransaction({ editBatches, timelineClips: clips })
        : createInMemoryEditTransaction({ editBatches, timelineClips: mode === 'write-fails' ? failingWrites : clips })
    const target = app((a) => {
      a.route('/', clipRoutes({ timelineClips: clips, projects, mediaAssets: createInMemoryMediaAssetRepository(), transaction }))
      a.route('/', clipSpanRoutes({ timelineClips: clips, projects, transaction }))
    })
    return { target, clips, editBatches, first, second }
  }

  const requests = (f: ReturnType<typeof build>) => ({
    置く: () =>
      send(f.target, 'POST', `/projects/${project.id}/clips`, {
        track: 'TEXT',
        startSec: 6,
        durationSec: 1,
        content: { type: 'text', templateKey: 'plain', params: { text: 'い' } },
      }),
    直す: () => send(f.target, 'PATCH', `/clips/${f.first.id}`, { startSec: 1 }),
    消す: () => send(f.target, 'DELETE', `/clips/${f.first.id}`),
    境目を動かす: () =>
      send(f.target, 'POST', `/projects/${project.id}/clips/spans`, {
        spans: [
          { id: f.first.id, startSec: 0, durationSec: 3 },
          { id: f.second.id, startSec: 3, durationSec: 1 },
        ],
      }),
  })

  for (const name of ['置く', '直す', '消す', '境目を動かす'] as const) {
    it(`${name}: 記録が作れなければ書き込まない`, async () => {
      const f = build('record-fails')
      const before = f.clips.snapshot()
      expect((await requests(f)[name]()).status).toBe(500)
      expect(f.clips.snapshot()).toEqual(before)
    })

    it(`${name}: 書き込みが落ちれば記録が残らない`, async () => {
      const f = build('write-fails')
      expect((await requests(f)[name]()).status).toBeGreaterThanOrEqual(400)
      expect(f.editBatches.snapshot()).toEqual([])
    })
  }
})

describe('Shot 1 件', () => {
  const build = (mode: Mode) => {
    const shot = aShot(project.id, { code: 'CUT-01', description: '夕焼け', status: 'review', selectedTakeId: null })
    const take = aTake(shot, 'a'.repeat(64))
    const selected: Shot = { ...aShot(project.id, { code: 'CUT-02', status: 'approved' }) }
    const selectedTake = aTake(selected, 'b'.repeat(64))
    const shots = createInMemoryShotRepository([shot, { ...selected, selectedTakeId: selectedTake.id }])
    const editBatches = createInMemoryEditBatchRepository()
    const failingWrites = { ...shots, update: reject, selectTake: reject }
    const transaction: EditTransaction =
      mode === 'record-fails'
        ? createFailingRecordTransaction({ editBatches, shots })
        : createInMemoryEditTransaction({ editBatches, shots: mode === 'write-fails' ? failingWrites : shots })
    const target = app((a) => {
      a.route(
        '/',
        shotSingleEditRoutes({
          shots,
          takes: createInMemoryTakeRepository([take, selectedTake]),
          locations: createInMemoryLocationRepository(),
          characters: createInMemoryCharacterRepository(),
          events: createInMemoryProjectEvents(),
          logger: createLogger('silent'),
          transaction,
        }),
      )
    })
    return { target, shots, editBatches, shot, take, selected }
  }

  const requests = (f: ReturnType<typeof build>) => ({
    直す: () => send(f.target, 'PATCH', `/shots/${f.shot.id}`, { description: '朝焼け' }),
    採用を決める: () => send(f.target, 'POST', `/shots/${f.shot.id}/select-take`, { takeId: f.take.id }),
    採用を外す: () => send(f.target, 'DELETE', `/shots/${f.selected.id}/selected-take`),
  })

  for (const name of ['直す', '採用を決める', '採用を外す'] as const) {
    it(`${name}: 記録が作れなければ書き込まない`, async () => {
      const f = build('record-fails')
      const before = await f.shots.findByProject(project.id)
      expect((await requests(f)[name]()).status).toBe(500)
      expect(await f.shots.findByProject(project.id)).toEqual(before)
    })

    it(`${name}: 書き込みが落ちれば記録が残らない`, async () => {
      const f = build('write-fails')
      expect((await requests(f)[name]()).status).toBeGreaterThanOrEqual(400)
      expect(f.editBatches.snapshot()).toEqual([])
    })
  }
})

describe('トランジション', () => {
  const build = (mode: Mode) => {
    const a = aShot(project.id, { order: 0, code: 'A', startSec: 0, durationSec: 4 })
    const b = aShot(project.id, { order: 1, code: 'B', startSec: 4, durationSec: 4 })
    const transitions = createInMemoryTransitionRepository()
    const editBatches = createInMemoryEditBatchRepository()
    const failingWrites = { ...transitions, create: reject, delete: reject }
    const transaction: EditTransaction =
      mode === 'record-fails'
        ? createFailingRecordTransaction({ editBatches, transitions })
        : createInMemoryEditTransaction({ editBatches, transitions: mode === 'write-fails' ? failingWrites : transitions })
    const target = app((root) => {
      root.route(
        '/',
        transitionRoutes({ transitions, shots: createInMemoryShotRepository([a, b]), projects: createInMemoryProjectRepository([project]), transaction }),
      )
    })
    return { target, transitions, editBatches, a, b }
  }

  const place = (f: ReturnType<typeof build>, extra: Record<string, unknown> = {}) =>
    send(f.target, 'POST', `/projects/${project.id}/transitions`, {
      fromShotId: f.a.id,
      toShotId: f.b.id,
      type: 'dissolve',
      durationSec: 0.5,
      ...extra,
    })

  /** 消す・差し替えの相手を、記録も書き込みも素通しで先に置く。 */
  const seeded = async (mode: Mode) => {
    const f = build(mode)
    const placed = await f.transitions.create({ projectId: project.id, fromShotId: f.a.id, toShotId: f.b.id, type: 'cut', durationSec: 0 })
    return { ...f, placed }
  }

  it('置く: 記録が作れなければ置かない / 置けなければ記録が残らない', async () => {
    const failRecord = build('record-fails')
    expect((await place(failRecord)).status).toBe(500)
    expect(failRecord.transitions.snapshot()).toEqual([])

    const failWrite = build('write-fails')
    expect((await place(failWrite)).status).toBe(500)
    expect(failWrite.editBatches.snapshot()).toEqual([])
  })

  it('消す: 記録が作れなければ消さない / 消せなければ記録が残らない', async () => {
    const failRecord = await seeded('record-fails')
    expect((await send(failRecord.target, 'DELETE', `/transitions/${failRecord.placed.id}`)).status).toBe(500)
    expect(failRecord.transitions.snapshot()).toEqual([failRecord.placed])

    const failWrite = await seeded('write-fails')
    expect((await send(failWrite.target, 'DELETE', `/transitions/${failWrite.placed.id}`)).status).toBe(500)
    expect(failWrite.editBatches.snapshot()).toEqual([])
  })

  it('差し替え: 記録が作れなければ前のトランジションを消さない', async () => {
    const f = await seeded('record-fails')
    expect((await place(f, { replaceTransitionId: f.placed.id })).status).toBe(500)
    expect(f.transitions.snapshot()).toEqual([f.placed])
  })
})

describe('楽曲', () => {
  const build = (mode: Mode) => {
    const first = MusicTrack.parse({
      id: newId(MusicTrackId),
      projectId: project.id,
      mediaAssetId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      title: '1 曲目',
      isMaster: true,
    })
    const second = MusicTrack.parse({ ...first, id: newId(MusicTrackId), title: '2 曲目', isMaster: false })
    const musicTracks = createInMemoryMusicTrackRepository([first, second])
    const editBatches = createInMemoryEditBatchRepository()
    const failingWrites = { ...musicTracks, update: () => Promise.resolve(null), setMaster: () => Promise.resolve(null) }
    const transaction: EditTransaction =
      mode === 'record-fails'
        ? createFailingRecordTransaction({ editBatches, musicTracks })
        : createInMemoryEditTransaction({ editBatches, musicTracks: mode === 'write-fails' ? failingWrites : musicTracks })
    const target = app((root) => {
      root.route('/', musicEditRoutes({ musicTracks, transaction }))
    })
    return { target, musicTracks, editBatches, first, second }
  }

  const requests = (f: ReturnType<typeof build>) => ({
    直す: () => send(f.target, 'PATCH', `/music-tracks/${f.first.id}`, { volume: 0.5 }),
    マスターを替える: () => send(f.target, 'POST', `/music-tracks/${f.second.id}/set-master`),
  })

  for (const name of ['直す', 'マスターを替える'] as const) {
    it(`${name}: 記録が作れなければ書き込まない`, async () => {
      const f = build('record-fails')
      const before = await f.musicTracks.findByProject(project.id)
      expect((await requests(f)[name]()).status).toBe(500)
      expect(await f.musicTracks.findByProject(project.id)).toEqual(before)
    })

    it(`${name}: 途中で消されていたら 404 で、記録が残らない`, async () => {
      const f = build('write-fails')
      expect((await requests(f)[name]()).status).toBe(404)
      expect(f.editBatches.snapshot()).toEqual([])
    })
  }
})

describe('ナレーションの行', () => {
  it('動かす: 記録が作れなければ動かさない', async () => {
    const setup = setupNarration({ recordFails: true })
    const [line] = await setup.deps.lines.createMany([{ projectId: setup.project.id, order: 0, text: 'あ。', startSec: 3 }])
    expect((await setup.send('PATCH', `/narration-lines/${String(line?.id)}`, { startSec: 8 })).status).toBe(500)
    expect(setup.deps.lines.snapshot()[0]?.startSec).toBe(3)
  })
})
