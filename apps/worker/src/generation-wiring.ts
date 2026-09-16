import { createPhase1EmptyContextSource } from '@ixa/domain'
import { createProviderRegistry } from '@ixa/provider-core'
import { createStubVideoProvider } from '@ixa/provider-video'
import { createS3Storage } from '@ixa/storage'
import {
  createDbClient,
  createGenerationJobRepository,
  createMediaAssetRepository,
  createProjectRepository,
  createShotRepository,
  createTakeRepository,
} from '@ixa/db'
import type { AppConfig } from '@ixa/config'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Logger } from 'pino'
import type { GenerationProcessorDeps, PollScheduler } from './generation/index.js'
import { QUEUE_NAMES } from './queues.js'

/**
 * 生成ジョブの実行に必要な依存を組み立てる。
 *
 * Provider の登録はここでのみ行う。Domain も processor も具体的な Provider を知らない。
 * Phase 1 はスタブのみ（ADR-0014）。fal.ai / BytePlus のアダプタが入ったら
 * この配列に足すだけで Model Router の候補に入る。
 */
export type GenerationWiring = {
  readonly deps: GenerationProcessorDeps
  readonly queue: Queue
  close(): Promise<void>
}

export const createGenerationWiring = (
  config: AppConfig,
  connection: Redis,
  logger: Logger,
  stubOutputDir: string,
): GenerationWiring => {
  const db = createDbClient(config.database.url)

  const storage = createS3Storage({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    bucket: config.s3.bucket,
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
    forcePathStyle: config.s3.forcePathStyle,
  })

  const queue = new Queue(QUEUE_NAMES.generation, { connection })

  /** ポーリングの再スケジュールは BullMQ の delay で行う。repeatable job は使わない。 */
  const scheduler: PollScheduler = {
    reschedule: async (data, delayMs) => {
      await queue.add('generate', data, { delay: delayMs })
    },
  }

  const registry = createProviderRegistry([
    createStubVideoProvider({ outputDir: stubOutputDir }),
  ])

  const deps: GenerationProcessorDeps = {
    generationJobs: createGenerationJobRepository(db),
    shots: createShotRepository(db),
    projects: createProjectRepository(db),
    mediaAssets: createMediaAssetRepository(db),
    takes: createTakeRepository(db),
    storage,
    registry,
    // Phase 2 でキャラクター・ロケーションのリポジトリに差し替える
    context: createPhase1EmptyContextSource(),
    scheduler,
    logger,
  }

  return {
    deps,
    queue,
    close: async () => {
      await queue.close()
      await db.$client.end()
    },
  }
}
