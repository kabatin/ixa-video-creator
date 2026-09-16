import { createProviderRegistry } from '@ixa/provider-core'
import { createGenerationContextSource } from '@ixa/generation'
import { createStubVideoProvider } from '@ixa/provider-video'
import { createS3Storage } from '@ixa/storage'
import {
  createDbClient,
  createGenerationJobRepository,
  createMediaAssetRepository,
  createProjectRepository,
  createRenderJobRepository,
  createShotRepository,
  createTakeRepository,
  createCharacterLookRepository,
  createCharacterRepository,
  createLocationRepository,
  createShotCharacterRepository,
  createShotReferenceRepository,
} from '@ixa/db'
import type { AppConfig } from '@ixa/config'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Logger } from 'pino'
import { createRemotionRenderer } from '@ixa/render'
import type { GenerationProcessorDeps, PollScheduler } from './generation/index.js'
import type { MediaProcessorDeps } from './media/index.js'
import type { RenderProcessorDeps } from './render/index.js'
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
  readonly media: MediaProcessorDeps
  readonly render: RenderProcessorDeps
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
    /**
     * **API 側と同じ実装を使うこと。**
     * 片方だけ空実装のままだと、API が解決した仕様と worker が組み直した仕様の
     * ハッシュが食い違い、spec_drift で全ての生成が失敗する（実際に起きた）。
     */
    context: createGenerationContextSource({
      shotCharacters: createShotCharacterRepository(db),
      characters: createCharacterRepository(db),
      looks: createCharacterLookRepository(db),
      locations: createLocationRepository(db),
      shotReferences: createShotReferenceRepository(db),
      shots: createShotRepository(db),
      takes: createTakeRepository(db),
      mediaAssets: createMediaAssetRepository(db),
    }),
    scheduler,
    logger,
  }

  const media: MediaProcessorDeps = {
    mediaAssets: createMediaAssetRepository(db),
    storage,
    workDir: process.env.MEDIA_WORK_DIR ?? '/tmp/ixa-media-work',
    logger,
  }

  const render: RenderProcessorDeps = {
    renderJobs: createRenderJobRepository(db),
    mediaAssets: createMediaAssetRepository(db),
    projects: createProjectRepository(db),
    storage,
    // Remotion を既定にする（ADR-0010）。個人利用のため無償。
    renderer: createRemotionRenderer({
      outputDir: process.env.RENDER_OUTPUT_DIR ?? '/tmp/ixa-render-output',
    }),
    logger,
  }

  return {
    deps,
    media,
    render,
    queue,
    close: async () => {
      await queue.close()
      await db.$client.end()
    },
  }
}
