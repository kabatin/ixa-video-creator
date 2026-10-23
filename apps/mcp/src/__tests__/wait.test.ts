import { UPSCALE_REASON } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { waitForChecks, type Check, type CheckResult } from '../lib/wait-loop.js'
import { waitTool } from '../tools/wait.js'
import { createFakeApi, depsFor, fakeClock, jsonOf, ownedShots, takeRow, textOf, ulid } from './fake-api.js'

const sequenceCheck = (states: readonly CheckResult['state'][]): Check & { readonly polls: () => number } => {
  const counter = { n: 0 }
  return {
    label: { kind: 'test' },
    polls: () => counter.n,
    poll: () => {
      const state = states[Math.min(counter.n, states.length - 1)] ?? 'pending'
      counter.n += 1
      return Promise.resolve({ state, detail: { poll: counter.n } })
    },
  }
}

describe('waitForChecks', () => {
  it('全部終わったら待たずに返す。終わったものは問い合わせ直さない', async () => {
    const clock = fakeClock()
    const a = sequenceCheck(['succeeded'])
    const b = sequenceCheck(['pending', 'pending', 'failed'])
    const outcome = await waitForChecks([a, b], clock, { maxWaitSec: 60 })
    expect(outcome).toMatchObject({ done: true, timedOut: false })
    expect(outcome.results.map((r) => r.state)).toEqual(['succeeded', 'failed'])
    expect(a.polls()).toBe(1)
    expect(b.polls()).toBe(3)
    // 間隔は 2 秒から 1.5 倍ずつ広がる。
    expect(clock.slept).toEqual([2000, 3000])
  })

  it('maxWaitSec で必ず返し、timedOut と途中経過を返す（1 時間ぶら下げない）', async () => {
    const clock = fakeClock()
    const outcome = await waitForChecks([sequenceCheck(['pending'])], clock, { maxWaitSec: 60 })
    expect(outcome).toMatchObject({ done: false, timedOut: true, elapsedSec: 60 })
    expect(Math.max(...clock.slept)).toBeLessThanOrEqual(15_000)
    expect(clock.slept.reduce((a, b) => a + b, 0)).toBe(60_000)
  })

  it('途中経過を知らせる', async () => {
    const seen: string[] = []
    await waitForChecks([sequenceCheck(['pending', 'succeeded'])], fakeClock(), {
      maxWaitSec: 60,
      onProgress: (done, total) => {
        seen.push(`${String(done)}/${String(total)}`)
        return Promise.resolve()
      },
    })
    expect(seen).toEqual(['0/1', '1/1'])
  })
})

const SHOT = ulid('SH1')
const TAKE = ulid('TK1')
const TRACK = ulid('TR1')
const JOB = ulid('JB1')
const PROJECT = ulid('PJ1')

describe('wait ツール', () => {
  it('種類ごとの口を読み、終わったかへ揃える', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/generation-jobs/${JOB}`, data: { id: JOB, shotId: SHOT, status: 'failed', resolvedModel: null, error: { code: 'x', message: '落ちました' } } },
      { method: 'GET', path: `/music-tracks/${TRACK}/analysis`, status: 404, data: 'まだ' },
      { method: 'GET', path: `/music-tracks/${TRACK}/analysis/failure`, data: { message: '解析できません', failedAt: '2026-10-17T00:00:00Z' } },
      { method: 'GET', path: `/shots/${SHOT}/start-frame`, data: { mediaAssetId: ulid('MD1'), job: { id: JOB, status: 'succeeded', error: null } } },
      {
        method: 'GET',
        path: `/shots/${SHOT}/start-frame/history`,
        data: {
          maxRetries: 2,
          items: [
            {
              jobId: JOB,
              status: 'succeeded',
              attempt: 1,
              retryOfJobId: null,
              mediaAssetId: ulid('MD1'),
              applied: true,
              current: true,
              check: { mark: 'pass', score: 0.9, issues: [], note: null },
              error: null,
              queuedAt: '2026-10-19T00:00:00.000Z',
            },
          ],
        },
      },
      {
        method: 'GET',
        path: `/shots/${SHOT}/takes`,
        data: [takeRow(TAKE, null, null, SHOT), takeRow(ulid('TK2'), TAKE, UPSCALE_REASON, SHOT)],
      },
      { method: 'GET', path: `/music-jobs/${JOB}`, data: { status: 'succeeded', error: null, musicTrackIds: [TRACK] } },
      ownedShots(PROJECT, [SHOT]),
      { method: 'GET', path: `/projects/${PROJECT}/music-jobs`, data: [{ id: JOB }] },
      { method: 'GET', path: `/projects/${PROJECT}/music-tracks`, data: [{ id: TRACK }] },
    ])
    const result = await waitTool.run(
      {
        projectId: PROJECT,
        jobs: [
          { kind: 'generation', id: JOB },
          { kind: 'analysis', id: TRACK },
          { kind: 'start_frame', id: SHOT },
          { kind: 'upscale', shotId: SHOT, takeId: TAKE },
          { kind: 'music', id: JOB },
        ],
      },
      depsFor(fake),
    )
    const outcome = jsonOf(result) as { done: boolean; results: Record<string, unknown>[] }
    expect(outcome.done).toBe(true)
    expect(outcome.results).toEqual([
      { kind: 'generation', id: JOB, state: 'failed', shotId: SHOT, error: '落ちました' },
      { kind: 'analysis', id: TRACK, state: 'failed', error: '解析できません' },
      {
        kind: 'start_frame',
        id: SHOT,
        state: 'succeeded',
        mediaAssetId: ulid('MD1'),
        check: { mark: 'pass', score: 0.9, issues: [], note: null },
        jobId: JOB,
      },
      { kind: 'upscale', shotId: SHOT, takeId: TAKE, state: 'succeeded', upscaledTakeId: ulid('TK2') },
      { kind: 'music', id: JOB, state: 'succeeded', musicTrackIds: [TRACK] },
    ])
  })

  it('声のジョブ（speak_narration）を kind:"voice" で待つ', async () => {
    const VOICE_JOB = ulid('VJ1')
    const LINE = ulid('NA1')
    const fake = createFakeApi([
      { method: 'GET', path: `/voice-jobs/${VOICE_JOB}`, sequence: [{ data: { status: 'running', lineId: LINE, error: null } }, { data: { status: 'succeeded', lineId: LINE, error: null } }] },
      { method: 'GET', path: `/projects/${PROJECT}/narration`, data: { lines: [{ id: LINE }] } },
    ])
    const result = await waitTool.run({ projectId: PROJECT, jobs: [{ kind: 'voice', id: VOICE_JOB }] }, depsFor(fake, { clock: fakeClock() }))
    expect(jsonOf(result)).toMatchObject({ done: true, results: [{ kind: 'voice', id: VOICE_JOB, state: 'succeeded', lineId: LINE }] })
  })

  it('作品の中で動いているものが止むまで待ち、時間切れなら timedOut で返す', async () => {
    const fake = createFakeApi([
      {
        method: 'GET',
        path: `/projects/${PROJECT}/generations/active`,
        data: [{ jobId: JOB, shotId: SHOT, status: 'running', modelId: null, estimatedLatencySec: null, queuedAt: 'x', providerStartedAt: null }],
      },
      { method: 'GET', path: `/projects/${PROJECT}/shot-posters`, data: [{ shotId: SHOT, hasStartFrame: false, drawing: true }] },
      { method: 'GET', path: `/projects/${PROJECT}/renders`, data: [] },
    ])
    const outcome = jsonOf(await waitTool.run({ projectId: PROJECT, maxWaitSec: 30 }, depsFor(fake))) as Record<string, unknown>
    expect(outcome).toMatchObject({ done: false, timedOut: true, elapsedSec: 30 })
    expect(outcome.results).toEqual([
      expect.objectContaining({ kind: 'project', state: 'pending', startFramesDrawing: 1, videoGenerations: { queued: 0, running: 1 } }),
    ])
  })

  it('projectId が無ければ断る', async () => {
    expect(textOf(await waitTool.run({ jobs: [{ kind: 'render', id: JOB }] }, depsFor(createFakeApi([]))))).toContain('projectId')
  })

  it('別の作品のジョブ・Shot・Take は待たない（状態も中身も返さない）', async () => {
    const fake = createFakeApi([
      { method: 'GET', path: `/projects/${PROJECT}/renders`, data: [] },
      ownedShots(PROJECT, []),
      { method: 'GET', path: /^\/(renders|shots)\//, data: {} },
    ])
    const deps = depsFor(fake)
    expect(textOf(await waitTool.run({ projectId: PROJECT, jobs: [{ kind: 'render', id: JOB }] }, deps))).toContain(JOB)
    expect(textOf(await waitTool.run({ projectId: PROJECT, jobs: [{ kind: 'start_frame', id: SHOT }] }, deps))).toContain(SHOT)
    expect(textOf(await waitTool.run({ projectId: PROJECT, jobs: [{ kind: 'upscale', shotId: SHOT, takeId: TAKE }] }, deps))).toContain(SHOT)
    expect(fake.callsTo('GET', /^\/(renders|shots)\//)).toHaveLength(0)
  })
})
