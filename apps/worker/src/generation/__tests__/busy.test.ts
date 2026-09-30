import { createPhase1EmptyContextSource, ProviderId as ProviderIdSchema } from '@ixa/domain'
import {
  createProviderRegistry,
  ProviderBusyError,
  ProviderError,
  type ProviderJobHandle,
  type VideoGenerationRequest,
} from '@ixa/provider-core'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it } from 'vitest'
import {
  SUBMIT_BUSY_DEADLINE_MS,
  SUBMIT_BUSY_DEFAULT_DELAY_MS,
  SUBMIT_BUSY_MAX_DELAY_MS,
  SUBMIT_BUSY_MIN_DELAY_MS,
  SUBMIT_BUSY_TIMEOUT_MESSAGE,
  submitBusyDelayMs,
  submitBusyExpired,
} from '../busy.js'
import {
  POLL_BACKOFF_BASE_MS,
  processGenerationJob,
  SPEC_DRIFT_MESSAGE,
  type GenerationProcessorDeps,
} from '../processor.js'
import { rebuildSpec } from '../spec.js'
import {
  aProject,
  aShot,
  createRecordingEvents,
  createRecordingMediaQueue,
  createRecordingScheduler,
  createTestProvider,
  inMemoryJobs,
  inMemoryMediaAssets,
  inMemoryProjects,
  inMemoryShots,
  inMemoryTakes,
  silentLogger,
  testModel,
} from './doubles.js'

const MODEL = testModel()
const PROVIDER_ID = ProviderIdSchema.parse('test')
const HOUR_MS = 60 * 60 * 1000

/**
 * 投入の結果を順に返す Provider。`'busy'` なら満杯で断り、数値ならその待ち時間つきで断る。
 * `'ok'` で受け付ける。投入が何回呼ばれたかを数える。
 */
const scriptedProvider = (script: readonly ('ok' | 'busy' | number | Error)[]) => {
  const base = createTestProvider([MODEL], [{ state: 'pending', progress: null }])
  const calls: VideoGenerationRequest[] = []
  return {
    ...base,
    submitCalls: () => calls,
    submit: (request: VideoGenerationRequest): Promise<ProviderJobHandle> => {
      const step = script[Math.min(calls.length, script.length - 1)] ?? 'ok'
      calls.push(request)
      if (step === 'ok') return base.submit(request)
      if (step instanceof Error) return Promise.reject(step)
      const retryAfterMs = step === 'busy' ? null : step
      return Promise.reject(new ProviderBusyError('満杯です', PROVIDER_ID, retryAfterMs))
    },
  }
}

const buildBusyFixture = async (
  script: readonly ('ok' | 'busy' | number | Error)[],
  clock: { now: Date } = { now: new Date() },
) => {
  const context = createPhase1EmptyContextSource()
  const project = aProject()
  const shot = aShot(project)
  const { specHash } = await rebuildSpec(context, shot, project, MODEL)
  const jobs = inMemoryJobs()
  const job = await jobs.create({
    shotId: shot.id,
    specHash,
    requestedModel: 'AUTO',
    resolvedModel: MODEL.id,
    corrections: [],
  })
  const shots = inMemoryShots([shot])
  const scheduler = createRecordingScheduler()
  const events = createRecordingEvents()
  const provider = scriptedProvider(script)

  const deps: GenerationProcessorDeps = {
    generationJobs: jobs,
    shots,
    projects: inMemoryProjects([project]),
    takes: inMemoryTakes(),
    mediaAssets: inMemoryMediaAssets(),
    storage: createMemoryStorage(),
    registry: createProviderRegistry([provider]),
    context,
    scheduler,
    mediaQueue: createRecordingMediaQueue(),
    events,
    logger: silentLogger,
    now: () => clock.now,
  }
  const run = () => processGenerationJob(deps, { generationJobId: job.id })
  return { deps, job, jobs, shots, shot, scheduler, events, provider, clock, run }
}

describe('submitBusyDelayMs', () => {
  it('示されなければ既定（60 秒）', () => {
    expect(submitBusyDelayMs(null)).toBe(SUBMIT_BUSY_DEFAULT_DELAY_MS)
    expect(SUBMIT_BUSY_DEFAULT_DELAY_MS).toBe(60_000)
  })

  it('30 秒〜10 分に収める（サーバを叩き続けず、長めに待てと言われたら従う）', () => {
    expect(submitBusyDelayMs(0)).toBe(SUBMIT_BUSY_MIN_DELAY_MS)
    expect(submitBusyDelayMs(5_000)).toBe(30_000)
    expect(submitBusyDelayMs(45_000)).toBe(45_000)
    expect(submitBusyDelayMs(300_000)).toBe(300_000)
    expect(submitBusyDelayMs(60 * 60_000)).toBe(SUBMIT_BUSY_MAX_DELAY_MS)
    expect(SUBMIT_BUSY_MAX_DELAY_MS).toBe(600_000)
    expect(submitBusyDelayMs(Number.NaN)).toBe(SUBMIT_BUSY_DEFAULT_DELAY_MS)
  })
})

describe('submitBusyExpired', () => {
  it('積んでから 12 時間を過ぎたら期限切れ', () => {
    const queuedAt = new Date('2026-09-30T00:00:00Z')
    expect(SUBMIT_BUSY_DEADLINE_MS).toBe(12 * HOUR_MS)
    expect(submitBusyExpired(queuedAt, new Date(queuedAt.getTime() + 12 * HOUR_MS))).toBe(false)
    expect(submitBusyExpired(queuedAt, new Date(queuedAt.getTime() + 12 * HOUR_MS + 1))).toBe(true)
  })
})

/**
 * 1 本ずつしか作れない Provider が満杯で断っても、ジョブを失敗にしない（ADR-0031）。
 */
describe('processGenerationJob — Provider が満杯のとき', () => {
  it('失敗にせず queued のまま、Retry-After に従って予約し直す', async () => {
    const f = await buildBusyFixture([45_000])

    const outcome = await f.run()

    expect(outcome).toEqual({ state: 'busy', delayMs: 45_000 })
    const job = f.jobs.snapshot()[0]
    expect(job?.status).toBe('queued')
    expect(job?.providerJobRef).toBeNull()
    expect(job?.startedAt).toBeNull()
    expect(job?.error).toBeNull()
    expect(f.scheduler.scheduled()).toEqual([
      { data: { generationJobId: f.job.id }, delayMs: 45_000 },
    ])
  })

  it('待ち時間が示されなければ 60 秒後に試す', async () => {
    const f = await buildBusyFixture(['busy'])
    expect(await f.run()).toEqual({ state: 'busy', delayMs: 60_000 })
  })

  it('問い合わせの回数を消費しない（投入後の待ちの上限を食わせない）', async () => {
    const f = await buildBusyFixture(['busy', 'busy', 'busy'])
    await f.run()
    await f.run()
    await f.run()
    expect(f.jobs.snapshot()[0]?.attempt).toBe(1)
    expect(f.provider.submitCalls()).toHaveLength(3)
  })

  it('running の出来事を流さない（まだ何も走っていない）', async () => {
    const f = await buildBusyFixture(['busy'])
    await f.run()
    expect(f.events.published()).toEqual([])
    expect(f.shots.snapshot()[0]?.status).toBe(f.shot.status)
  })

  it('空いたら投入し、そこから普通のポーリングに入る', async () => {
    const f = await buildBusyFixture(['busy', 'ok'])
    await f.run()

    const outcome = await f.run()

    expect(outcome).toEqual({ state: 'submitted', providerJobRef: 'provider-job-1' })
    expect(f.jobs.snapshot()[0]?.status).toBe('running')
    expect(f.scheduler.scheduled().map((s) => s.delayMs)).toEqual([60_000, POLL_BACKOFF_BASE_MS])
  })

  it('待っている間に Shot が変わったら、投入せず spec_drift で止める', async () => {
    const f = await buildBusyFixture(['busy', 'ok'])
    await f.run()
    await f.shots.update(f.shot.id, { description: '待っている間に直した演出' })

    const outcome = await f.run()

    expect(outcome).toEqual({ state: 'failed', code: 'spec_drift' })
    expect(f.provider.submitCalls()).toHaveLength(1)
    // 画面の文は、前の Shot の採用 Take が変わった場合も含めて理由を言う（内部のハッシュは出さない）。
    const message = f.jobs.snapshot()[0]?.error?.message ?? ''
    expect(message).toBe(SPEC_DRIFT_MESSAGE)
    expect(message).toContain('前の Shot の採用 Take')
    expect(message).not.toMatch(/[0-9a-f]{64}/)
  })

  it('投入のたびに GenerationJob の ID を冪等キーとして渡す（投げ直しても同じ生成）', async () => {
    const f = await buildBusyFixture(['busy', 'ok'])
    await f.run()
    await f.run()
    expect(f.provider.submitCalls().map((request) => request.idempotencyKey)).toEqual([
      f.job.id,
      f.job.id,
    ])
  })

  it('予約し直せなければ queued のまま取り残さず、終端の失敗にする', async () => {
    const f = await buildBusyFixture(['busy'])
    const deps: GenerationProcessorDeps = {
      ...f.deps,
      scheduler: { reschedule: () => Promise.reject(new Error('Redis に接続できません')) },
    }

    const outcome = await processGenerationJob(deps, { generationJobId: f.job.id })

    expect(outcome.state).toBe('failed')
    expect(f.jobs.snapshot()[0]?.status).toBe('failed')
    expect(f.jobs.snapshot()[0]?.providerJobRef).toBeNull()
  })

  it('積んでから 12 時間を過ぎても空かなければ、やり直せる失敗として諦める', async () => {
    const clock = { now: new Date() }
    const f = await buildBusyFixture(['busy'], clock)
    clock.now = new Date(f.job.queuedAt.getTime() + SUBMIT_BUSY_DEADLINE_MS + 1)

    const outcome = await f.run()

    expect(outcome).toEqual({ state: 'failed', code: 'provider_busy_timeout' })
    const job = f.jobs.snapshot()[0]
    expect(job?.status).toBe('failed')
    expect(job?.error?.retryable).toBe(true)
    expect(job?.error?.message).toContain('12 時間')
    expect(job?.error?.message).toBe(SUBMIT_BUSY_TIMEOUT_MESSAGE)
    expect(f.scheduler.scheduled()).toEqual([])
    // 失敗の理由を画面まで運ぶ（黙って失敗にしない）。
    expect(f.events.published().some((e) => e.type === 'generation_job.status')).toBe(true)
  })

  it('満杯以外の投入の失敗は、今までどおり終端にする', async () => {
    const f = await buildBusyFixture([new ProviderError('壊れた', PROVIDER_ID, true)])

    const outcome = await f.run()

    expect(outcome.state).toBe('failed')
    expect(f.jobs.snapshot()[0]?.status).toBe('failed')
    expect(f.scheduler.scheduled()).toEqual([])
  })
})
