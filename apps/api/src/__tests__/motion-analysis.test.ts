import { OpenAPIHono } from '@hono/zod-openapi'
import {
  MOTION_ANALYZER_VERSION,
  TakeMotionAnalysisId,
  newId,
  type MediaAsset,
  type MediaAssetId,
  type MotionAnalysis,
  type TakeId,
} from '@ixa/domain'
import { aShot, aTake, createInMemoryShotRepository, createInMemoryTakeRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import type { MotionAnalysisDeps, MotionQueueState } from '../motion/deps.js'
import { loadProjectMotionEvents } from '../motion/shot-motion.js'
import { motionAnalysisRoutes } from '../routes/motion-analysis.js'
import { aProject } from './fixtures.js'

/** Take の動きの分析の口（ADR-0054）。積むのは API、測るのは worker。結果は Take の秒とタイムラインの秒で返す。 */

type Ok<T> = { success: true; data: T }

const analysis = (takeId: TakeId, overrides: Partial<MotionAnalysis> = {}): MotionAnalysis => ({
  id: newId(TakeMotionAnalysisId),
  takeId,
  analyzerVersion: MOTION_ANALYZER_VERSION,
  status: 'succeeded',
  energyHopSec: 0.5,
  energy: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.5],
  onsets: [{ atSec: 1, strength: 1 }, { atSec: 5, strength: 0.4 }],
  events: [
    { kind: 'moment', takeStartSec: 1, takeDurationSec: 0.2, label: '着地', sfxPrompt: 'soft footstep', confidence: 0.9 },
    { kind: 'moment', takeStartSec: 5, takeDurationSec: 0.2, label: '着地', sfxPrompt: 'soft footstep', confidence: 0.9 },
  ],
  visionUsed: true,
  costUsd: 0.05,
  failureMessage: null,
  createdAt: new Date('2026-10-19T00:00:00Z'),
  ...overrides,
})

const setup = (options: { readonly rows?: (takeId: TakeId) => readonly MotionAnalysis[]; readonly queued?: MotionQueueState } = {}) => {
  const project = aProject()
  const base = aShot(project.id, { startSec: 20, durationSec: 4 })
  const take = aTake(base, 'a'.repeat(64))
  const shot = { ...base, selectedTakeId: take.id }
  const otherShot = aShot(project.id, { code: 'S-2', order: 2000, startSec: 24, durationSec: 4 })
  const rows = options.rows?.(take.id) ?? []
  const enqueued: TakeId[] = []
  const deps: MotionAnalysisDeps = {
    takes: createInMemoryTakeRepository([take]),
    shots: createInMemoryShotRepository([shot, otherShot]),
    mediaAssets: {
      findById: (id: MediaAssetId) =>
        Promise.resolve(id === take.mediaAssetId ? ({ probe: { durationSec: 6 } } as unknown as MediaAsset) : null),
    },
    analyses: {
      findLatestByTake: (takeId) => Promise.resolve([...rows].reverse().find((r) => r.takeId === takeId) ?? null),
      findLatestSucceededByTakes: (takeIds) =>
        Promise.resolve(
          new Map(
            takeIds.flatMap((id) => {
              const found = [...rows].reverse().find((r) => r.takeId === id && r.status === 'succeeded')
              return found === undefined ? [] : [[id, found] as const]
            }),
          ),
        ),
    },
    queue: {
      enqueue: (takeId) => {
        enqueued.push(takeId)
        return Promise.resolve()
      },
      stateOf: () => Promise.resolve(options.queued ?? null),
    },
  }
  const logger = createLogger('silent')
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', motionAnalysisRoutes(deps))
  registerErrorHandlers(app, logger)
  const send = (method: string, path: string) => app.request(path, { method })
  return { project, shot, otherShot, take, enqueued, deps, send }
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

describe('POST /takes/{id}/motion-analysis', () => {
  it('分析を worker の motion キューへ積み、待っていると返す', async () => {
    const { take, enqueued, send } = setup()
    const res = await send('POST', `/takes/${take.id}/motion-analysis`)
    expect(res.status).toBe(202)
    expect((await json<Ok<{ state: string }>>(res)).data.state).toBe('queued')
    expect(enqueued).toEqual([take.id])
  })

  it('知らない Take は 404', async () => {
    const { send } = setup()
    expect((await send('POST', `/takes/${newId(TakeMotionAnalysisId)}/motion-analysis`)).status).toBe(404)
  })
})

describe('GET /takes/{id}/motion-analysis', () => {
  it('まだなら none', async () => {
    const { take, send } = setup()
    const body = await json<Ok<{ state: string; analysis: unknown }>>(await send('GET', `/takes/${take.id}/motion-analysis`))
    expect(body.data).toMatchObject({ state: 'none', analysis: null })
  })

  it('積んである間は queued・running を返す', async () => {
    const { take, send } = setup({ queued: 'running' })
    const body = await json<Ok<{ state: string }>>(await send('GET', `/takes/${take.id}/motion-analysis`))
    expect(body.data.state).toBe('running')
  })

  it('失敗の行は理由を返し、前に成功した結果は残して見せる', async () => {
    const { take, send } = setup({
      rows: (takeId) => [analysis(takeId), analysis(takeId, { status: 'failed', failureMessage: '失敗しました。', events: [] })],
    })
    const body = await json<Ok<{ state: string; failureMessage: string; analysis: { events: unknown[] } }>>(
      await send('GET', `/takes/${take.id}/motion-analysis`),
    )
    expect(body.data.state).toBe('failed')
    expect(body.data.failureMessage).toBe('失敗しました。')
    expect(body.data.analysis.events).toHaveLength(2)
  })
})

describe('GET /shots/{id}/motion-analysis', () => {
  it('採用中の Take の結果を、映る範囲だけタイムラインの秒に直して返す', async () => {
    const { shot, send } = setup({ rows: (takeId) => [analysis(takeId)] })
    const body = await json<
      Ok<{
        state: string
        events: { startSec: number }[]
        onsets: { atSec: number }[]
        energy: { startSec: number; hopSec: number; values: number[] }
        suggestions: { kind: string; cue: { startSec: number } }[]
      }>
    >(await send('GET', `/shots/${shot.id}/motion-analysis`))
    expect(body.data.state).toBe('succeeded')
    // Shot は 20 秒から 4 秒。Take の 5 秒は映らない
    expect(body.data.events.map((e) => e.startSec)).toEqual([21])
    expect(body.data.onsets.map((o) => o.atSec)).toEqual([21])
    expect(body.data.energy).toMatchObject({ startSec: 20, hopSec: 0.5 })
    expect(body.data.energy.values).toHaveLength(8)
    expect(body.data.suggestions.map((s) => [s.kind, s.cue.startSec])).toEqual([['motion_moment', 21]])
    // 瞬間は、音の一番大きいところを時刻に合わせる印を持つ（下限は Shot の始まり）。
    expect((body.data.suggestions[0]?.cue as { align?: unknown }).align).toEqual({ to: 'peak', notBeforeSec: 20 })
  })

  it('採用中の Take が無い Shot は none で takeId は null', async () => {
    const { otherShot, send } = setup()
    const body = await json<Ok<{ state: string; takeId: string | null }>>(await send('GET', `/shots/${otherShot.id}/motion-analysis`))
    expect(body.data).toMatchObject({ state: 'none', takeId: null })
  })

  it('POST で採用中の Take を分析に積み、Take が無ければ 409', async () => {
    const { shot, otherShot, take, enqueued, send } = setup()
    expect((await send('POST', `/shots/${shot.id}/motion-analysis`)).status).toBe(202)
    expect(enqueued).toEqual([take.id])
    expect((await send('POST', `/shots/${otherShot.id}/motion-analysis`)).status).toBe(409)
  })
})

describe('loadProjectMotionEvents', () => {
  it('作品の全 Shot の採用中の Take の出来事を、タイムラインの秒で集める', async () => {
    const { project, deps } = setup({ rows: (takeId) => [analysis(takeId)] })
    const events = await loadProjectMotionEvents(deps, project.id)
    expect(events.map((e) => e.startSec)).toEqual([21])
  })
})
