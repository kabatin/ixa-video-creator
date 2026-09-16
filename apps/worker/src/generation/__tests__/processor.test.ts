import { createPhase1EmptyContextSource, type GenerationJob } from '@ixa/domain'
import { createProviderRegistry } from '@ixa/provider-core'
import type { ProviderJobStatus } from '@ixa/provider-core'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it, vi } from 'vitest'
import type { DownloadedObject } from '../download.js'
import {
  POLL_BACKOFF_BASE_MS, POLL_BACKOFF_MAX_MS, pollDelayMs, processGenerationJob,
  type GenerationProcessorDeps,
} from '../processor.js'
import { rebuildSpec } from '../spec.js'
import {
  aProject, aShot, createRecordingScheduler, createTestProvider, inMemoryJobs,
  inMemoryMediaAssets, inMemoryProjects, inMemoryShots, inMemoryTakes, silentLogger, testModel,
} from './doubles.js'

const MODEL = testModel()

/** 実ダウンロードはしない。キーだけ受け取って結果を返す。 */
const fakeDownload = vi.fn(
  (options: { key: string }): Promise<DownloadedObject> =>
    Promise.resolve({
      storageKey: options.key,
      bytes: 4096,
      contentType: 'video/mp4',
      checksumSha256: 'a'.repeat(64),
    }),
)

const SUCCEEDED: ProviderJobStatus = {
  state: 'succeeded',
  outputUrl: 'https://cdn.example.com/out.mp4',
  seedUsed: 4242,
  costUsd: 0.4,
  raw: { id: 'provider-job-1' },
}

const buildFixture = async (statuses: readonly ProviderJobStatus[]) => {
  const project = aProject()
  const shot = aShot(project)
  const context = createPhase1EmptyContextSource()
  const { specHash } = await rebuildSpec(context, shot, project, MODEL)

  const jobs = inMemoryJobs()
  const job: GenerationJob = await jobs.create({
    shotId: shot.id,
    specHash,
    requestedModel: 'AUTO',
    resolvedModel: MODEL.id,
  })

  const shots = inMemoryShots([shot])
  const takes = inMemoryTakes()
  const mediaAssets = inMemoryMediaAssets()
  const scheduler = createRecordingScheduler()

  const deps: GenerationProcessorDeps = {
    generationJobs: jobs,
    shots,
    projects: inMemoryProjects([project]),
    takes,
    mediaAssets,
    storage: createMemoryStorage(),
    registry: createProviderRegistry([createTestProvider([MODEL], statuses)]),
    context,
    scheduler,
    logger: silentLogger,
    download: fakeDownload,
  }

  return { deps, job, shot, project, jobs, shots, takes, mediaAssets, scheduler, specHash }
}

/** 投入 → 完了まで 2 回走らせる。 */
const runToCompletion = async (f: Awaited<ReturnType<typeof buildFixture>>) => {
  const first = await processGenerationJob(f.deps, { generationJobId: f.job.id })
  const second = await processGenerationJob(f.deps, { generationJobId: f.job.id })
  return { first, second }
}

describe('processGenerationJob', () => {
  it('未投入なら Provider へ submit し、ポーリングを予約する', async () => {
    const f = await buildFixture([{ state: 'pending', progress: null }])

    const outcome = await processGenerationJob(f.deps, { generationJobId: f.job.id })

    expect(outcome).toEqual({ state: 'submitted', providerJobRef: 'provider-job-1' })
    expect(f.jobs.snapshot()[0]?.status).toBe('running')
    expect(f.jobs.snapshot()[0]?.providerJobRef).toBe('provider-job-1')
    expect(f.scheduler.scheduled()).toEqual([
      { data: { generationJobId: f.job.id }, delayMs: POLL_BACKOFF_BASE_MS },
    ])
  })

  it('成功したら MediaAsset と Take を作り、Shot を review にする', async () => {
    const f = await buildFixture([SUCCEEDED])

    const { second } = await runToCompletion(f)

    expect(second.state).toBe('succeeded')

    const takes = f.takes.snapshot()
    expect(takes).toHaveLength(1)
    const take = takes[0]
    expect(take?.index).toBe(1)
    expect(take?.shotId).toBe(f.shot.id)
    expect(take?.specHash).toBe(f.specHash)
    expect(take?.seedUsed).toBe(4242)
    expect(take?.costUsd).toBe(0.4)
    expect(take?.generationTimeSec).toBeGreaterThanOrEqual(0)
    expect(take?.spec.durationSec).toBe(4) // 編集尺 3.75 秒 → 4 秒へ切り上げ（ADR-0011）

    const assets = f.mediaAssets.snapshot()
    expect(assets).toHaveLength(1)
    expect(assets[0]?.origin).toEqual({ type: 'generated', takeId: take?.id })
    // 期限付き URL は保存しない
    expect(JSON.stringify(assets[0])).not.toContain('https://cdn.example.com')

    expect(f.shots.snapshot()[0]?.status).toBe('review')
    expect(f.jobs.snapshot()[0]?.status).toBe('succeeded')
  })

  it('同じジョブが 2 回走っても Take を二重に作らない（冪等）', async () => {
    const f = await buildFixture([SUCCEEDED])

    await runToCompletion(f)
    expect(f.takes.snapshot()).toHaveLength(1)

    // 3 回目・4 回目。BullMQ の再試行や重複配信を想定する。
    const again = await processGenerationJob(f.deps, { generationJobId: f.job.id })
    const andAgain = await processGenerationJob(f.deps, { generationJobId: f.job.id })

    expect(again).toEqual({ state: 'skipped', reason: 'status=succeeded' })
    expect(andAgain.state).toBe('skipped')
    expect(f.takes.snapshot()).toHaveLength(1)
    expect(f.mediaAssets.snapshot()).toHaveLength(1)
  })

  it('未完了なら指数バックオフで入れ直す（repeatable job を使わない）', async () => {
    const f = await buildFixture([
      { state: 'running', progress: 0.3 },
      { state: 'running', progress: 0.6 },
    ])

    await processGenerationJob(f.deps, { generationJobId: f.job.id })
    const second = await processGenerationJob(f.deps, { generationJobId: f.job.id })
    const third = await processGenerationJob(f.deps, { generationJobId: f.job.id })

    expect(second).toEqual({ state: 'polling', delayMs: pollDelayMs(2) })
    expect(third).toEqual({ state: 'polling', delayMs: pollDelayMs(3) })
    expect(f.jobs.snapshot()[0]?.attempt).toBe(3)
    expect(f.takes.snapshot()).toHaveLength(0)
  })

  it('Provider が失敗したら error に code / message / retryable を記録する', async () => {
    const f = await buildFixture([
      {
        state: 'failed',
        error: { code: 'content_policy', message: '生成が拒否されました', retryable: false },
      },
    ])

    const { second } = await runToCompletion(f)

    expect(second).toEqual({ state: 'failed', code: 'content_policy' })
    const job = f.jobs.snapshot()[0]
    expect(job?.status).toBe('failed')
    expect(job?.error).toEqual({
      code: 'content_policy',
      message: '生成が拒否されました',
      retryable: false,
    })
    expect(f.takes.snapshot()).toHaveLength(0)
  })

  it('Shot が変更されて仕様がずれたら投入せずに失敗させる', async () => {
    const f = await buildFixture([SUCCEEDED])
    await f.shots.update(f.shot.id, { description: '差し替えられた演出' })

    const outcome = await processGenerationJob(f.deps, { generationJobId: f.job.id })

    expect(outcome).toEqual({ state: 'failed', code: 'spec_drift' })
    expect(f.jobs.snapshot()[0]?.error?.retryable).toBe(false)
  })

  it('ジョブが存在しなければ例外を投げる', async () => {
    const f = await buildFixture([SUCCEEDED])
    await expect(
      processGenerationJob(f.deps, { generationJobId: '01JBXV0000000000000000000A' }),
    ).rejects.toThrow()
  })

  it('ジョブデータの形が違えば例外を投げる', async () => {
    const f = await buildFixture([SUCCEEDED])
    await expect(processGenerationJob(f.deps, { shotId: 'nope' })).rejects.toThrow()
  })
})

describe('pollDelayMs', () => {
  it('指数的に伸び、上限で頭打ちになる', () => {
    expect(pollDelayMs(1)).toBe(POLL_BACKOFF_BASE_MS)
    expect(pollDelayMs(2)).toBe(POLL_BACKOFF_BASE_MS * 2)
    expect(pollDelayMs(3)).toBe(POLL_BACKOFF_BASE_MS * 4)
    expect(pollDelayMs(50)).toBe(POLL_BACKOFF_MAX_MS)
  })
})
