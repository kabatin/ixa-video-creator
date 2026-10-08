import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import {
  createMediaAssetRepository,
  createProjectRepository,
  createShotRepository,
  createTakeRepository,
  createUpscaleJobRepository,
  type DbClient,
} from '@ixa/db'
import { createVpipeUpscaler, VPIPE_IDENTITY } from '@ixa/provider-video'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { LocalGpuLease } from './generation/local-gpu-lease.js'
import type { MediaJobQueue } from './generation/processor.js'
import { QUEUE_NAMES } from './queues.js'
import type { UpscaleProcessorDeps, UpscaleScheduler } from './upscale/index.js'

/**
 * 解像度を上げる口の配線（ADR-0044）。
 *
 * **手元の GPU の順番（整理券）は生成と共有する。** 同じ `localGpuLease` を渡すので、
 * H3 の生成と同時には走らない。
 *
 * vpipe の URL が無ければ `null`（この機械には上げる口が無い）。その場合、
 * API 側は「対応していない」と答えるので、ジョブが積まれることはない。
 */
export const createUpscaleWiring = (input: {
  readonly db: DbClient
  readonly connection: Redis
  readonly storage: ObjectStorage
  readonly localGpuLease: LocalGpuLease
  /** 素材を計測する口。**生成と同じものを渡す**（別に作ると二重に走る）。 */
  readonly mediaQueue: MediaJobQueue
  readonly logger: Logger
  readonly outputRoot: string
  readonly vpipe: { readonly baseUrl: string | null; readonly token: string | null }
}): { readonly deps: UpscaleProcessorDeps; readonly queue: Queue } | null => {
  const { baseUrl } = input.vpipe
  if (baseUrl === null || baseUrl === '') return null

  const queue = new Queue(QUEUE_NAMES.upscale, { connection: input.connection })
  const scheduler: UpscaleScheduler = {
    reschedule: async (data, delayMs) => {
      await queue.add('upscale', data, { delay: delayMs })
    },
  }

  const upscaler = createVpipeUpscaler({
    http: {
      identity: VPIPE_IDENTITY,
      fetch: (url, init) => fetch(url, init),
      baseUrl: baseUrl.replace(/\/+$/, ''),
      token: input.vpipe.token,
      timeoutMs: 60_000,
    },
    outputDir: input.outputRoot,
  })

  return {
    queue,
    deps: {
      upscaleJobs: createUpscaleJobRepository(input.db),
      takes: createTakeRepository(input.db),
      shots: createShotRepository(input.db),
      projects: createProjectRepository(input.db),
      mediaAssets: createMediaAssetRepository(input.db),
      storage: input.storage,
      upscaler,
      mediaQueue: input.mediaQueue,
      localGpuLease: input.localGpuLease,
      scheduler,
      logger: input.logger,
    },
  }
}
