import { createPhase1EmptyContextSource, ProviderId as ProviderIdSchema } from '@ixa/domain'
import {
  createProviderRegistry,
  ProviderError,
  type PollPolicy,
  type ProviderJobStatus,
  type VideoProvider,
} from '@ixa/provider-core'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLL_POLICY,
  MAX_POLL_ATTEMPTS,
  pollDelayMs,
  pollPolicyForJob,
  pollPolicyOf,
} from '../poll-policy.js'
import { processGenerationJob, type GenerationProcessorDeps } from '../processor.js'
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
const PENDING: ProviderJobStatus = { state: 'pending', progress: null }
/** vpipe と同じ形の方針（30 秒おき）。回数はテストで上限を踏めるよう小さくする。 */
const FAST: PollPolicy = { maxIntervalMs: 30_000, maxAttempts: 5 }

const withPolicy = (provider: VideoProvider, policy: PollPolicy | undefined): VideoProvider =>
  policy === undefined ? provider : { ...provider, pollPolicy: policy }

const buildFixture = async (policy: PollPolicy | undefined, pollError?: Error) => {
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
  const scheduler = createRecordingScheduler()
  const base = withPolicy(createTestProvider([MODEL], [PENDING]), policy)
  const provider: VideoProvider =
    pollError === undefined ? base : { ...base, poll: () => Promise.reject(pollError) }

  const deps: GenerationProcessorDeps = {
    generationJobs: jobs,
    shots: inMemoryShots([shot]),
    projects: inMemoryProjects([project]),
    takes: inMemoryTakes(),
    mediaAssets: inMemoryMediaAssets(),
    storage: createMemoryStorage(),
    registry: createProviderRegistry([provider]),
    context,
    scheduler,
    mediaQueue: createRecordingMediaQueue(),
    events: createRecordingEvents(),
    logger: silentLogger,
  }
  const run = () => processGenerationJob(deps, { generationJobId: job.id })
  return { deps, job, jobs, scheduler, run }
}

/** 投入 1 回 + 問い合わせ n 回を走らせ、予約された待ちを返す。 */
const delaysAfter = async (policy: PollPolicy | undefined, polls: number): Promise<number[]> => {
  const f = await buildFixture(policy)
  for (let i = 0; i <= polls; i += 1) await f.run()
  return f.scheduler.scheduled().map((s) => s.delayMs)
}

describe('pollDelayMs', () => {
  it('方針が無ければ今までどおり（5 秒から倍々、最大 2 分）', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => pollDelayMs(n))).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 120_000, 120_000, 120_000,
    ])
  })

  it('方針があれば伸ばし方は同じで、上限だけが変わる', () => {
    expect([1, 2, 3, 4, 5, 60].map((n) => pollDelayMs(n, FAST))).toEqual([
      5_000, 10_000, 20_000, 30_000, 30_000, 30_000,
    ])
  })
})

describe('pollPolicyOf / pollPolicyForJob', () => {
  it('Provider が持っていればそれ、無ければ既定（最大 2 分・60 回）', () => {
    expect(pollPolicyOf({ pollPolicy: FAST })).toBe(FAST)
    expect(pollPolicyOf({})).toBe(DEFAULT_POLL_POLICY)
    expect(DEFAULT_POLL_POLICY).toEqual({ maxIntervalMs: 120_000, maxAttempts: MAX_POLL_ATTEMPTS })
  })

  it('モデルが決まっていない・登録が無いジョブは既定へ倒す', async () => {
    const f = await buildFixture(FAST)
    const registry = f.deps.registry
    expect(pollPolicyForJob(registry, f.job)).toBe(FAST)
    expect(pollPolicyForJob(registry, { ...f.job, resolvedModel: null })).toBe(DEFAULT_POLL_POLICY)
    expect(
      pollPolicyForJob(registry, {
        ...f.job,
        resolvedModel: testModel('test/unregistered').id,
      }),
    ).toBe(DEFAULT_POLL_POLICY)
  })
})

describe('processGenerationJob — Provider の問い合わせの方針', () => {
  it('方針の無い Provider は今までどおり最大 2 分おき', async () => {
    const delays = await delaysAfter(undefined, 6)
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 120_000, 120_000])
  })

  it('方針のある Provider は、最初の予約から上限（30 秒）で頭打ちになる', async () => {
    const delays = await delaysAfter(FAST, 4)
    expect(delays).toEqual([5_000, 10_000, 20_000, 30_000, 30_000])
  })

  it('方針の回数を超えたら諦める（既定の 60 回を待たない）', async () => {
    const f = await buildFixture(FAST)
    await f.run()
    await f.jobs.update(f.job.id, { attempt: FAST.maxAttempts })

    const outcome = await f.run()

    expect(outcome).toEqual({ state: 'failed', code: 'poll_timeout' })
    expect(f.jobs.snapshot()[0]?.error?.message).toContain(`${String(FAST.maxAttempts)} 回`)
  })

  it('方針の無い Provider は同じ回数ではまだ諦めない', async () => {
    const f = await buildFixture(undefined)
    await f.run()
    await f.jobs.update(f.job.id, { attempt: FAST.maxAttempts })

    expect((await f.run()).state).toBe('polling')
  })

  it('方針の回数が既定より多ければ、既定の 60 回を超えても待ち続ける', async () => {
    const f = await buildFixture({ maxIntervalMs: 30_000, maxAttempts: 360 })
    await f.run()
    await f.jobs.update(f.job.id, { attempt: MAX_POLL_ATTEMPTS + 10 })

    expect(await f.run()).toEqual({ state: 'polling', delayMs: 30_000 })
  })
})

describe('問い合わせが一時的に失敗したときも同じ方針を使う', () => {
  const PROVIDER_ID = ProviderIdSchema.parse('test')

  const failingPoll = async (policy: PollPolicy | undefined) => {
    const f = await buildFixture(policy, new ProviderError('503', PROVIDER_ID, true))
    // 投入は通る（poll だけが投げる）。
    expect((await f.run()).state).toBe('submitted')
    return f
  }

  it('予約し直す待ちは方針の上限で頭打ちになる', async () => {
    const f = await failingPoll(FAST)
    await f.jobs.update(f.job.id, { attempt: 4 })

    expect(await f.run()).toEqual({ state: 'polling', delayMs: 30_000 })
  })

  it('方針の回数を超えたら、一時的な失敗でも諦める', async () => {
    const f = await failingPoll(FAST)
    await f.jobs.update(f.job.id, { attempt: FAST.maxAttempts })

    expect((await f.run()).state).toBe('failed')
  })

  it('方針の無い Provider は今までどおり最大 2 分で予約し直す', async () => {
    const f = await failingPoll(undefined)
    await f.jobs.update(f.job.id, { attempt: 10 })

    expect(await f.run()).toEqual({ state: 'polling', delayMs: 120_000 })
  })
})
