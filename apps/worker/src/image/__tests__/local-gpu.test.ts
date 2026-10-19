import {
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  ModelId,
  newId,
  ProjectId,
  ProviderId,
  type ImageGenerationJob,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { silentLogger } from '../../generation/__tests__/doubles.js'
import {
  createInMemoryLocalGpuLease,
  LOCAL_GPU_HEAD_RETRY_AFTER_MS,
  LOCAL_GPU_RETRY_AFTER_MS,
  type LocalGpuLease,
} from '../../generation/local-gpu-lease.js'
import { holdLocalGpu, IMAGE_GPU_WAIT_DEADLINE_MS, takeLocalGpuTurn, type ImageGpuDeps } from '../local-gpu.js'
import { ImageJobCancelled, ImageJobFailure } from '../steps.js'

/**
 * 手元の GPU を使う絵（ADR-0047）は、動画・高画質化と**同じ整理券**に並ぶ。
 * 見たいのは: 順番が来ていなければ待たずに待ち時間を返す・止められたら／期限を過ぎたら券を返して手を引く・
 * 借りている間は延ばし続け、終わったら（投げても）返す。
 */

const QUEUED_AT = new Date('2026-10-16T12:00:00Z')

const aJob = (): ImageGenerationJob => ({
  id: newId(ImageGenerationJobIdSchema),
  projectId: newId(ProjectId),
  kind: 'start_frame',
  shotId: null,
  characterId: null,
  status: 'queued',
  providerId: ProviderId.parse('klein'),
  modelId: ModelId.parse('klein/flux2-klein'),
  referenceAssetIds: [],
  mediaAssetId: null,
  error: null,
  providerRecord: null,
  retryOfJobId: null,
  attempt: 1,
  appliedAt: null,
  instruction: null,
  queuedAt: QUEUED_AT,
  startedAt: null,
  finishedAt: null,
})

const depsFor = (
  lease: LocalGpuLease,
  job: ImageGenerationJob,
  options: { readonly now?: () => Date; readonly status?: ImageGenerationJob['status']; readonly renewMs?: number } = {},
): ImageGpuDeps => ({
  localGpuLease: lease,
  imageJobs: { findById: () => Promise.resolve({ ...job, status: options.status ?? job.status }) },
  logger: silentLogger,
  now: options.now ?? (() => QUEUED_AT),
  ...(options.renewMs === undefined ? {} : { gpuRenewIntervalMs: options.renewMs }),
})

/** 動画が 1 本借りている状態を作る。 */
const busyLease = async (): Promise<LocalGpuLease> => {
  const lease = createInMemoryLocalGpuLease()
  expect(await lease.acquire('video-job', QUEUED_AT.getTime() - 1000)).toEqual({ state: 'acquired' })
  return lease
}

describe('takeLocalGpuTurn', () => {
  it('空いていれば取る', async () => {
    const job = aJob()
    expect(await takeLocalGpuTurn(depsFor(createInMemoryLocalGpuLease(), job), job)).toEqual({ state: 'acquired' })
  })

  it('動画が借りていれば待たずに待ち時間を返す（次は自分の番なので短く）', async () => {
    const lease = await busyLease()
    const job = aJob()
    expect(await takeLocalGpuTurn(depsFor(lease, job), job)).toEqual({ state: 'wait', delayMs: LOCAL_GPU_HEAD_RETRY_AFTER_MS })
    // 自分より先に積まれた動画が並んでいれば長く待つ。
    expect((await lease.acquire('earlier-video', QUEUED_AT.getTime() - 500)).state).toBe('held')
    expect(await takeLocalGpuTurn(depsFor(lease, job), job)).toEqual({ state: 'wait', delayMs: LOCAL_GPU_RETRY_AFTER_MS })
  })

  /** 券を残したまま手を引くと、死んだ券が後ろの動画を 15 分止める。 */
  it('止められていたら、券を返して手を引く', async () => {
    const lease = await busyLease()
    const job = aJob()
    await expect(takeLocalGpuTurn(depsFor(lease, job, { status: 'cancelled' }), job)).rejects.toBeInstanceOf(ImageJobCancelled)
    await lease.release('video-job')
    expect(await lease.acquire('later-video', QUEUED_AT.getTime() + 5000)).toEqual({ state: 'acquired' })
  })

  it('積んでから期限を過ぎても順番が来なければ、理由を言ってやめる（券は返す）', async () => {
    const lease = await busyLease()
    const job = aJob()
    const late = new Date(QUEUED_AT.getTime() + IMAGE_GPU_WAIT_DEADLINE_MS + 1)
    const error: unknown = await takeLocalGpuTurn(depsFor(lease, job, { now: () => late }), job).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ImageJobFailure)
    expect((error as ImageJobFailure).failure).toMatchObject({ code: 'local_gpu_timeout', retryable: true })
    await lease.release('video-job')
    expect(await lease.acquire('later-video', QUEUED_AT.getTime() + 5000)).toEqual({ state: 'acquired' })
  })

  it('順番を確かめられない（Redis が落ちている）ときは、実装の言葉を画面に出さない', async () => {
    const job = aJob()
    const broken: LocalGpuLease = {
      acquire: () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:6379 Redis')),
      renew: () => Promise.reject(new Error('unused')),
      release: () => Promise.resolve(),
    }
    const error: unknown = await takeLocalGpuTurn(depsFor(broken, job), job).catch((e: unknown) => e)
    expect((error as ImageJobFailure).failure.code).toBe('local_gpu_unavailable')
    expect((error as ImageJobFailure).failure.message).not.toMatch(/Redis|ECONNREFUSED|6379/)
  })
})

describe('holdLocalGpu', () => {
  it('作っている間は動画に渡さず、終わったら返す', async () => {
    const lease = createInMemoryLocalGpuLease()
    const job = aJob()
    await takeLocalGpuTurn(depsFor(lease, job), job)
    await holdLocalGpu(depsFor(lease, job), job, async () => {
      expect((await lease.acquire('video-job', QUEUED_AT.getTime() + 1)).state).toBe('held')
    })
    await lease.release('video-job')
    expect(await lease.acquire('video-job', QUEUED_AT.getTime() + 1)).toEqual({ state: 'acquired' })
  })

  it('作っている途中で投げても返す', async () => {
    const lease = createInMemoryLocalGpuLease()
    const job = aJob()
    await takeLocalGpuTurn(depsFor(lease, job), job)
    await expect(holdLocalGpu(depsFor(lease, job), job, () => Promise.reject(new Error('壊れた')))).rejects.toThrow('壊れた')
    expect(await lease.acquire('video-job', QUEUED_AT.getTime() + 1)).toEqual({ state: 'acquired' })
  })

  /** 延ばさないと、5 分を超える絵の途中で順番が切れ、動画と同時に GPU を使う。 */
  it('借りている間は、自分の借りを延ばし続ける', async () => {
    const base = createInMemoryLocalGpuLease()
    const renewed: string[] = []
    const lease: LocalGpuLease = {
      ...base,
      renew: (id) => {
        renewed.push(id)
        return base.renew(id)
      },
    }
    const job = aJob()
    await takeLocalGpuTurn(depsFor(lease, job), job)
    await holdLocalGpu(depsFor(lease, job, { renewMs: 5 }), job, () => new Promise((resolve) => setTimeout(resolve, 40)))
    expect(renewed.length).toBeGreaterThanOrEqual(2)
    expect(new Set(renewed)).toEqual(new Set([job.id]))
    // 返したあとは延ばさない。
    const count = renewed.length
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(renewed).toHaveLength(count)
  })
})
