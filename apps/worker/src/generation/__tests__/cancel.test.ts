import { createPhase1EmptyContextSource, ModelId } from '@ixa/domain'
import {
  createProviderRegistry,
  type ProviderJobStatus,
  type VideoProvider,
} from '@ixa/provider-core'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it } from 'vitest'
import {
  MAX_POLL_ATTEMPTS,
  processGenerationJob,
  type GenerationProcessorDeps,
} from '../processor.js'
import { createInMemoryLocalGpuLease } from '../local-gpu-lease.js'
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

/**
 * 生成をやめたあとの worker（制作者 2026-10-01「動画生成をキャンセル出来るようにしたい」）。
 *
 * API はジョブの行を取り消しにする（`apps/api/src/routes/generation-cancel.ts`）。worker は 1 回分の処理の
 * 途中でも取り消されうるので、**書く直前に読み直し**、取り消されていれば Take にしない・状態を上書きしない。
 */

const MODEL = testModel()

const SUCCEEDED: ProviderJobStatus = {
  state: 'succeeded',
  output: { type: 'remote' as const, url: 'https://cdn.example.com/out.mp4' },
  seedUsed: 1,
  costUsd: 0.4,
  raw: {},
}

const FAILED: ProviderJobStatus = {
  state: 'failed',
  error: { code: 'provider_canceled', message: '生成先で取り消されました', retryable: false },
}

type When = 'never' | 'submit' | 'poll'

const build = async (pollStatus: ProviderJobStatus) => {
  const project = aProject()
  // API が取り消して Shot を決め直したあと（Take が無いので下書き）。
  const shot = aShot(project, { status: 'draft' })
  const context = createPhase1EmptyContextSource()
  const { specHash } = await rebuildSpec(context, shot, project, MODEL)
  const jobs = inMemoryJobs()
  const job = await jobs.create({
    shotId: shot.id,
    specHash,
    requestedModel: 'AUTO',
    resolvedModel: MODEL.id,
  })

  const state: { when: When } = { when: 'never' }
  const stopped: string[] = []
  const cancelNow = () => jobs.update(job.id, { status: 'cancelled', finishedAt: new Date() })
  const base = createTestProvider([MODEL], [pollStatus])
  const provider: VideoProvider = {
    ...base,
    submit: async (request) => {
      const handle = await base.submit(request)
      if (state.when === 'submit') await cancelNow()
      return handle
    },
    poll: async (handle) => {
      const status = await base.poll(handle)
      if (state.when === 'poll') await cancelNow()
      return status
    },
    cancel: (handle) => {
      stopped.push(handle.ref)
      return Promise.resolve()
    },
  }

  const shots = inMemoryShots([shot])
  const takes = inMemoryTakes()
  const scheduler = createRecordingScheduler()
  const deps: GenerationProcessorDeps = {
    localGpuLease: createInMemoryLocalGpuLease(),
    generationJobs: jobs,
    shots,
    projects: inMemoryProjects([project]),
    takes,
    mediaAssets: inMemoryMediaAssets(),
    storage: createMemoryStorage(),
    registry: createProviderRegistry([provider]),
    context,
    scheduler,
    mediaQueue: createRecordingMediaQueue(),
    events: createRecordingEvents(),
    logger: silentLogger,
    download: (options: { key: string }) =>
      Promise.resolve({
        storageKey: options.key,
        bytes: 4096,
        contentType: 'video/mp4',
        checksumSha256: 'a'.repeat(64),
      }),
  }
  const run = () => processGenerationJob(deps, { generationJobId: job.id })
  const current = async () => (await jobs.findById(job.id))?.status
  /** 次の問い合わせで上限を超える。 */
  const exhaustPolls = () => jobs.update(job.id, { attempt: MAX_POLL_ATTEMPTS })
  /** 登録の無いモデルを指す（送る前に落ちる）。 */
  const breakModel = () => jobs.update(job.id, { resolvedModel: ModelId.parse('test/unknown') })
  return { state, stopped, run, current, takes, shots, scheduler, shot, exhaustPolls, breakModel }
}

describe('生成をやめたあとの worker', () => {
  it('送っている間に取り消されたら、生成先にも止めてと頼み、作成中にしない', async () => {
    const f = await build(SUCCEEDED)
    f.state.when = 'submit'

    const outcome = await f.run()

    expect(outcome.state).toBe('skipped')
    expect(await f.current()).toBe('cancelled')
    expect(f.stopped).toEqual(['provider-job-1'])
    // 問い合わせを予約しない（止めたものを待たない）
    expect(f.scheduler.scheduled()).toHaveLength(0)
  })

  it('作っている間に取り消されたら、届いた結果を Take にしない', async () => {
    const f = await build(SUCCEEDED)
    await f.run() // 送る
    f.state.when = 'poll'

    const outcome = await f.run() // 問い合わせると出来ている。その間に取り消された

    expect(outcome.state).toBe('skipped')
    expect(await f.current()).toBe('cancelled')
    expect(await f.takes.findByShot(f.shot.id)).toHaveLength(0)
    // Shot の状態は API が決め直したまま（採用待ちにしない）
    expect((await f.shots.findById(f.shot.id))?.status).toBe('draft')
  })

  it('問い合わせが失敗で返っても、取り消しを失敗で上書きしない', async () => {
    const f = await build(FAILED)
    await f.run()
    f.state.when = 'poll'

    const outcome = await f.run()

    expect(outcome.state).toBe('skipped')
    expect(await f.current()).toBe('cancelled')
    expect((await f.shots.findById(f.shot.id))?.status).toBe('draft')
  })

  it('取り消されていなければ、今までどおり Take にする', async () => {
    const f = await build(SUCCEEDED)
    await f.run()

    const outcome = await f.run()

    expect(outcome.state).toBe('succeeded')
    expect(await f.takes.findByShot(f.shot.id)).toHaveLength(1)
  })
})

/**
 * 失敗で終えたジョブは、生成先にも止めてと頼む（PR #4 レビュー #4）。
 * 問い合わせの上限で諦めても、vpipe は作り続けて唯一の GPU を占める。
 */
describe('失敗で終えたジョブ', () => {
  it('問い合わせの上限で諦めたら、生成先にも止めてと頼む', async () => {
    const f = await build({ state: 'pending', progress: null })
    await f.run() // 送る
    await f.exhaustPolls()

    const outcome = await f.run()

    expect(outcome).toMatchObject({ state: 'failed', code: 'poll_timeout' })
    expect(f.stopped).toEqual(['provider-job-1'])
  })

  it('生成先へ送る前の失敗では、止めてと頼む相手が無い', async () => {
    const f = await build(SUCCEEDED)
    await f.breakModel()

    const outcome = await f.run()

    expect(outcome.state).toBe('failed')
    expect(f.stopped).toEqual([])
  })
})

