import { createPhase1EmptyContextSource, type GenerationJob } from '@ixa/domain'
import { createProviderRegistry, type ProviderJobStatus } from '@ixa/provider-core'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it, vi } from 'vitest'
import { generationBenchmarkOf } from '../benchmark.js'
import type { DownloadedObject } from '../download.js'
import { createInMemoryLocalGpuLease } from '../local-gpu-lease.js'
import { processGenerationJob, type GenerationProcessorDeps } from '../processor.js'
import { rebuildSpec } from '../spec.js'
import {
  aProject,
  aShot,
  createCapturingLogger,
  createRecordingEvents,
  createRecordingMediaQueue,
  createRecordingScheduler,
  createTestProvider,
  inMemoryJobs,
  inMemoryMediaAssets,
  inMemoryProjects,
  inMemoryShots,
  inMemoryTakes,
  testModel,
} from './doubles.js'

/**
 * 生成 1 本の実測（ADR-0040）。MiniMax H3 と Wan 2.2 を後から数字で比べるための 1 行。
 *
 * **プロンプトの全文も署名付き URL も入れない**（規約 7）。入るのは数字と識別子だけ。
 */

const MODEL = testModel()

const jobWith = (overrides: Partial<GenerationJob>): GenerationJob =>
  ({
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    shotId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    status: 'running',
    requestedModel: MODEL.id,
    resolvedModel: MODEL.id,
    routerDecision: null,
    corrections: [],
    seed: null,
    specHash: 'x'.repeat(64),
    providerJobRef: 'provider-job-1',
    attempt: 1,
    error: null,
    queuedAt: new Date('2026-10-06T12:00:00Z'),
    startedAt: new Date('2026-10-06T12:00:05Z'),
    providerStartedAt: new Date('2026-10-06T12:00:35Z'),
    finishedAt: null,
    ...overrides,
  }) as GenerationJob

const succeeded = (raw: Record<string, unknown>): Extract<ProviderJobStatus, { state: 'succeeded' }> => ({
  state: 'succeeded',
  output: { type: 'remote', url: 'https://cdn.example.com/out.mp4?sig=secret' },
  seedUsed: 4242,
  costUsd: 0,
  raw,
})

describe('generationBenchmarkOf', () => {
  const now = new Date('2026-10-06T12:08:15Z')

  it('生成先が報せた実測（段・順番待ち・生成時間・出来た尺）をそのまま使う', () => {
    const benchmark = generationBenchmarkOf({
      job: jobWith({}),
      model: MODEL,
      requestedDurationSec: 4,
      now,
      status: succeeded({
        quality: 'draft',
        queuedSec: 30,
        renderSec: 420,
        output: { durationSec: 4.002 },
      }),
    })

    expect(benchmark).toEqual({
      provider: MODEL.providerId,
      modelId: MODEL.id,
      qualityTier: 'draft',
      requestedDurationSec: 4,
      // 積んでから終わるまで（12:00:00 → 12:08:15）。
      totalElapsedSec: 495,
      remoteQueuedSec: 30,
      generationSec: 420,
      outputDurationSec: 4.002,
      failureType: null,
    })
  })

  /** 生成先が時間を返さないこともある。そのときは worker が測った時刻から出す。 */
  it('生成先が実測を返さなければ、こちらで測った時刻から出す', () => {
    const benchmark = generationBenchmarkOf({
      job: jobWith({}),
      model: MODEL,
      requestedDurationSec: 4,
      now,
      status: succeeded({}),
    })

    // 送った 12:00:05 → 作り始めた 12:00:35 = 30 秒。
    expect(benchmark.remoteQueuedSec).toBe(30)
    // 作り始めた 12:00:35 → いま 12:08:15 = 460 秒。
    expect(benchmark.generationSec).toBe(460)
    expect(benchmark.qualityTier).toBeNull()
    expect(benchmark.outputDurationSec).toBeNull()
  })

  /** 失敗だけ記録に残らないと、失敗の多いモデルが速く見える。 */
  it('失敗したときも同じ形で、種類を添えて残す', () => {
    const benchmark = generationBenchmarkOf({
      job: jobWith({ providerStartedAt: null }),
      model: MODEL,
      requestedDurationSec: 10,
      now,
      failureType: 'wan_metal_oom',
    })

    expect(benchmark.failureType).toBe('wan_metal_oom')
    expect(benchmark.outputDurationSec).toBeNull()
    expect(benchmark.requestedDurationSec).toBe(10)
    // 作り始めていないので順番待ちは測れない（0 と言わない）。
    expect(benchmark.remoteQueuedSec).toBeNull()
  })

  it('読めない数字は 0 で埋めず null にする', () => {
    const benchmark = generationBenchmarkOf({
      job: jobWith({ startedAt: null, providerStartedAt: null }),
      model: MODEL,
      requestedDurationSec: null,
      now,
      status: succeeded({ queuedSec: 'おかしな値', renderSec: null, output: null }),
    })

    expect(benchmark.requestedDurationSec).toBeNull()
    expect(benchmark.remoteQueuedSec).toBeNull()
    expect(benchmark.outputDurationSec).toBeNull()
  })

  it('プロンプトも署名付き URL も入らない', () => {
    const text = JSON.stringify(
      generationBenchmarkOf({
        job: jobWith({}),
        model: MODEL,
        requestedDurationSec: 4,
        now,
        status: succeeded({ quality: 'draft', prompt: 'takepi が勝利する' }),
      }),
    )
    expect(text).not.toContain('takepi')
    expect(text).not.toContain('http')
    expect(text).not.toContain('sig=secret')
  })
})

describe('生成ジョブが実測を 1 行残す', () => {
  const fakeDownload = vi.fn((options: { key: string }): Promise<DownloadedObject> =>
    Promise.resolve({
      storageKey: options.key,
      bytes: 4096,
      contentType: 'video/mp4',
      checksumSha256: 'a'.repeat(64),
    }),
  )

  const buildFixture = async (statuses: readonly ProviderJobStatus[]) => {
    const context = createPhase1EmptyContextSource()
    const project = aProject()
    const shot = aShot(project)
    const { specHash } = await rebuildSpec(context, shot, project, MODEL)
    const jobs = inMemoryJobs()
    const job = await jobs.create({
      shotId: shot.id,
      specHash,
      requestedModel: MODEL.id,
      resolvedModel: MODEL.id,
      corrections: [],
    seed: null,
    })
    // 実測は info で残すので、拾える高さにする。
    const logger = createCapturingLogger('info')
    const deps: GenerationProcessorDeps = {
      localGpuLease: createInMemoryLocalGpuLease(),
      generationJobs: jobs,
      shots: inMemoryShots([shot]),
      projects: inMemoryProjects([project]),
      takes: inMemoryTakes(),
      mediaAssets: inMemoryMediaAssets(),
      storage: createMemoryStorage(),
      registry: createProviderRegistry([createTestProvider([MODEL], statuses)]),
      context,
      scheduler: createRecordingScheduler(),
      mediaQueue: createRecordingMediaQueue(),
      events: createRecordingEvents(),
      logger: logger.logger,
      download: fakeDownload,
    }
    return {
      logger,
      run: () => processGenerationJob(deps, { generationJobId: job.id }),
    }
  }

  const benchmarkLines = (logger: ReturnType<typeof createCapturingLogger>) =>
    logger.lines().filter((line) => line.msg === '生成の実測')

  it('成功したときに残す', async () => {
    const f = await buildFixture([
      {
        state: 'succeeded',
        output: { type: 'remote', url: 'https://cdn.example.com/out.mp4' },
        seedUsed: 1,
        costUsd: 0,
        raw: { quality: 'draft', queuedSec: 12, renderSec: 300, output: { durationSec: 4 } },
      },
    ])
    await f.run()
    expect((await f.run()).state).toBe('succeeded')

    expect(benchmarkLines(f.logger)).toHaveLength(1)
  })

  it('失敗したときにも残す', async () => {
    const f = await buildFixture([
      { state: 'failed', error: { code: 'wan_generation_failed', message: 'だめ', retryable: false } },
    ])
    await f.run()
    expect((await f.run()).state).toBe('failed')

    expect(benchmarkLines(f.logger)).toHaveLength(1)
  })
})
