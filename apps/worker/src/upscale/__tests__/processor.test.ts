import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MediaAssetId,
  TakeId,
  UPSCALE_REASON,
  UpscaleJobId,
  newId,
  type MediaAsset,
  type Project,
  type Shot,
  type Take,
  type UpscaleJob,
  type UpscaleJobError,
} from '@ixa/domain'
import type { UpscaleJobRepository } from '@ixa/db'
import type { ProviderJobStatus, VideoUpscaler } from '@ixa/provider-core'
import { aTake } from '@ixa/generation/testing'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it } from 'vitest'
import {
  aProject,
  aShot,
  createCapturingLogger,
  createRecordingScheduler,
  inMemoryMediaAssets,
  inMemoryProjects,
  inMemoryShots,
  inMemoryTakes,
} from '../../generation/__tests__/doubles.js'
import { createInMemoryLocalGpuLease, type LocalGpuLease } from '../../generation/local-gpu-lease.js'
import { processUpscaleJob, type UpscaleProcessorDeps } from '../processor.js'

/**
 * 解像度を上げる仕事の流れ（ADR-0044）。
 *
 * 見たいのは 3 つ。
 * - **順番を取らずに投入しない**（手元の GPU は 1 本ずつ。生成と同じ列で待つ）
 * - **出来た Take が元の仕様を写し、系譜を持つ**（作る瞬間にしか入らない）
 * - **出す大きさは元と同じ**（推測で埋めない）
 */

const SOURCE_SPEC_HASH = 'a'.repeat(64)

const aMediaAsset = (
  project: Project,
  takeId: TakeId,
  overrides: Partial<MediaAsset> = {},
): MediaAsset => ({
  id: newId(MediaAssetId),
  workspaceId: project.workspaceId,
  projectId: project.id,
  kind: 'video',
  storageKey: 'media/source.mp4',
  mimeType: 'video/mp4',
  bytes: 1024,
  checksumSha256: 'b'.repeat(64),
  probe: {
    width: 1920,
    height: 1080,
    fps: 24,
    durationSec: 2.5,
    hasAudio: false,
    codec: 'h264',
  },
  proxyKey: null,
  thumbnailKey: null,
  posterKeys: [],
  // 元の Take が作った素材（上げる対象は必ず生成物）。
  origin: { type: 'generated', takeId },
  tags: [],
  createdAt: new Date('2026-10-09T00:00:00.000Z'),
  lastFrameAssetId: null,
  ...overrides,
})

/** 元にする Take。共有のフィクスチャに、ID と素材だけを差し込む。 */
const aSourceTake = (shot: Shot, id: TakeId, mediaAssetId: MediaAssetId): Take =>
  aTake(shot, SOURCE_SPEC_HASH, {
    id,
    mediaAssetId,
    modelId: 'vpipe/minimax-h3-turbo-draft' as Take['modelId'],
    seedUsed: 42,
    costUsd: 0,
  })

/** ジョブの行だけを持つ偽のリポジトリ。 */
const inMemoryUpscaleJobs = (seed: UpscaleJob) => {
  let job = seed
  const repo: UpscaleJobRepository & { snapshot: () => UpscaleJob } = {
    snapshot: () => job,
    create: () => Promise.reject(new Error('使わない')),
    findById: (id) => Promise.resolve(id === job.id ? job : null),
    findActiveByProject: () => Promise.resolve([]),
    findLatestByShot: () => Promise.resolve(job),
    cancelActive: () => Promise.resolve([]),
    markRunning: (_id, input) => {
      job = {
        ...job,
        status: 'running',
        providerJobRef: input.providerJobRef,
        estimateSeconds: input.estimateSeconds,
        startedAt: new Date('2026-10-09T00:01:00.000Z'),
      }
      return Promise.resolve(job)
    },
    markSucceeded: (_id, takeId) => {
      job = { ...job, status: 'succeeded', takeId, finishedAt: new Date() }
      return Promise.resolve(job)
    },
    markFailed: (_id, error: UpscaleJobError) => {
      job = { ...job, status: 'failed', error, finishedAt: new Date() }
      return Promise.resolve(job)
    },
  }
  return repo
}

const stubUpscaler = (overrides: Partial<VideoUpscaler> = {}): VideoUpscaler & {
  readonly submitted: () => readonly unknown[]
} => {
  const submitted: unknown[] = []
  return {
    providerId: 'vpipe' as VideoUpscaler['providerId'],
    modelId: 'vpipe/flashvsr-upscale' as VideoUpscaler['modelId'],
    exclusiveResource: 'local-gpu',
    submitted: () => submitted,
    available: () => Promise.resolve(true),
    submit: (request) => {
      submitted.push(request)
      return Promise.resolve({
        handle: {
          providerId: 'vpipe' as VideoUpscaler['providerId'],
          modelId: 'vpipe/flashvsr-upscale' as VideoUpscaler['modelId'],
          ref: 'job_up_1',
          submittedAt: new Date(),
        },
        estimateSeconds: 409,
      })
    },
    poll: () => Promise.resolve({ state: 'running', progress: 0.5 } satisfies ProviderJobStatus),
    cancel: () => Promise.resolve(),
    ...overrides,
  }
}

const buildFixture = async (options: {
  readonly upscaler?: VideoUpscaler
  readonly lease?: LocalGpuLease
  readonly jobOverrides?: Partial<UpscaleJob>
} = {}) => {
  const project = aProject()
  const shot = aShot(project)
  // 素材と Take は相互に参照するので、先に ID を採番して循環を断つ（本番と同じ順）。
  const sourceTakeId = newId(TakeId)
  const asset = aMediaAsset(project, sourceTakeId)
  const source = aSourceTake(shot, sourceTakeId, asset.id)

  const mediaAssets = inMemoryMediaAssets()
  await mediaAssets.create({ ...asset })
  const takes = inMemoryTakes()
  await takes.create({ ...source })

  const storage = createMemoryStorage()
  await storage.put(asset.storageKey, Buffer.from('ソースの中身'), { contentType: 'video/mp4' })

  const job: UpscaleJob = {
    id: newId(UpscaleJobId),
    projectId: project.id,
    shotId: shot.id,
    sourceTakeId: source.id,
    status: 'queued',
    providerId: 'vpipe' as UpscaleJob['providerId'],
    modelId: 'vpipe/flashvsr-upscale' as UpscaleJob['modelId'],
    takeId: null,
    providerJobRef: null,
    error: null,
    estimateSeconds: null,
    providerRecord: null,
    queuedAt: new Date('2026-10-09T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    ...options.jobOverrides,
  }

  const upscaleJobs = inMemoryUpscaleJobs(job)
  const scheduler = createRecordingScheduler()
  const upscaler = options.upscaler ?? stubUpscaler()

  const deps: UpscaleProcessorDeps = {
    upscaleJobs,
    takes,
    shots: inMemoryShots([shot]),
    projects: inMemoryProjects([project]),
    mediaAssets,
    storage,
    upscaler,
    localGpuLease: options.lease ?? createInMemoryLocalGpuLease(),
    scheduler: { reschedule: (data, delayMs) => scheduler.reschedule(data as never, delayMs) },
    logger: createCapturingLogger().logger,
    now: () => new Date('2026-10-09T00:05:00.000Z'),
  }

  return { deps, job, source, takes, upscaleJobs, scheduler, upscaler }
}

describe('投入', () => {
  it('元の動画と、元と同じ大きさを渡す', async () => {
    const f = await buildFixture()
    const result = await processUpscaleJob(f.deps, { upscaleJobId: f.job.id })

    expect(result.state).toBe('submitted')
    const [request] = (f.upscaler as ReturnType<typeof stubUpscaler>).submitted()
    // **推測で埋めない。** 元の Take の実測から取る
    expect(request).toMatchObject({
      output: { width: 1920, height: 1080 },
      video: { mediaType: 'video/mp4' },
    })
  })

  it('送ったら、生成先のジョブと見込みを行に積む', async () => {
    const f = await buildFixture()
    await processUpscaleJob(f.deps, { upscaleJobId: f.job.id })

    const job = f.upscaleJobs.snapshot()
    expect(job.status).toBe('running')
    expect(job.providerJobRef).toBe('job_up_1')
    // 走っている間の「あと何分」はこの値が正
    expect(job.estimateSeconds).toBe(409)
  })

  /**
   * **順番を取らずに投入しない。** 手元の GPU は 1 本ずつで、生成と同じ列で待つ。
   * 取れなければ何も送らず、queued のまま置く。
   */
  it('順番が取れなければ、何も送らずに待つ', async () => {
    const lease = createInMemoryLocalGpuLease()
    await lease.acquire('ほかの仕事', 0)
    const f = await buildFixture({ lease })

    const result = await processUpscaleJob(f.deps, { upscaleJobId: f.job.id })

    expect(result.state).toBe('busy')
    expect((f.upscaler as ReturnType<typeof stubUpscaler>).submitted()).toHaveLength(0)
    expect(f.upscaleJobs.snapshot().status).toBe('queued')
    // 取り残さない（やり直しが予約されている）
    expect(f.scheduler.scheduled()).toHaveLength(1)
  })
})

describe('出来上がり', () => {
  const succeededUpscaler = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ixa-upscale-'))
    const path = join(dir, 'out.mp4')
    await writeFile(path, Buffer.from('上げたあとの中身'))
    return stubUpscaler({
      poll: () =>
        Promise.resolve({
          state: 'succeeded',
          output: { type: 'local', path },
          seedUsed: null,
          costUsd: 0,
          raw: { workflow: 'flashvsr-upscale' },
        } satisfies ProviderJobStatus),
    })
  }

  it('元の Take の隣に積み、仕様を写して系譜を入れる', async () => {
    const f = await buildFixture({
      upscaler: await succeededUpscaler(),
      jobOverrides: { status: 'running', providerJobRef: 'job_up_1', startedAt: new Date('2026-10-09T00:01:00.000Z') },
    })

    const result = await processUpscaleJob(f.deps, { upscaleJobId: f.job.id })

    expect(result.state).toBe('succeeded')
    const takes = f.takes.snapshot()
    expect(takes).toHaveLength(2)
    const made = takes.find((t) => t.id !== f.source.id)
    // **仕様は元から写す**（同じ仕様であり、違うのは後処理だから）
    expect(made?.specHash).toBe(SOURCE_SPEC_HASH)
    expect(made?.spec).toEqual(f.source.spec)
    // **系譜は作る瞬間にしか入らない**
    expect(made?.parentTakeId).toBe(f.source.id)
    expect(made?.regenerationReason).toBe(UPSCALE_REASON)
    // 種は無く、手元の GPU なので費用も 0
    expect(made?.seedUsed).toBeNull()
    expect(made?.costUsd).toBe(0)
  })

  it('出来た Take を行に残す', async () => {
    const f = await buildFixture({
      upscaler: await succeededUpscaler(),
      jobOverrides: { status: 'running', providerJobRef: 'job_up_1', startedAt: new Date('2026-10-09T00:01:00.000Z') },
    })

    await processUpscaleJob(f.deps, { upscaleJobId: f.job.id })

    const job = f.upscaleJobs.snapshot()
    expect(job.status).toBe('succeeded')
    expect(job.takeId).not.toBeNull()
  })
})

/** 同じジョブが 2 回走っても Take を二重に作らない。 */
describe('終わっているジョブ', () => {
  it('取り消し済みなら何もしない', async () => {
    const f = await buildFixture({ jobOverrides: { status: 'cancelled' } })

    const result = await processUpscaleJob(f.deps, { upscaleJobId: f.job.id })

    expect(result.state).toBe('skipped')
    expect((f.upscaler as ReturnType<typeof stubUpscaler>).submitted()).toHaveLength(0)
    expect(f.takes.snapshot()).toHaveLength(1)
  })
})
