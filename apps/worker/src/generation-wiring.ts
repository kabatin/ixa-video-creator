import { createProviderRegistry } from '@ixa/provider-core'
import { createGenerationContextSource } from '@ixa/generation'
import { createStubVideoProvider } from '@ixa/provider-video'
import { createS3Storage } from '@ixa/storage'
import {
  createDbClient,
  createGenerationJobRepository,
  createMediaAssetRepository,
  createMusicAnalysisRepository,
  createMusicTrackRepository,
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
import type { ProjectEventPublisher } from '@ixa/domain'
import type { AppConfig } from '@ixa/config'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Logger } from 'pino'
import { createRemotionRenderer } from '@ixa/render'
import { createMusicAnalyzer } from '@ixa/music'
import type { AnalysisProcessorDeps } from './analysis/index.js'
import {
  createUnwiredEventPublisher,
  type GenerationProcessorDeps,
  type PollScheduler,
} from './generation/index.js'
import type { MediaProcessorDeps } from './media/index.js'
import type { RenderProcessorDeps } from './render/index.js'
import { createReviewWiring, type ReviewWiring } from './review-wiring.js'
import { createRegenerationEnqueue } from './regeneration-wiring.js'
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
  readonly analysis: AnalysisProcessorDeps
  readonly review: ReviewWiring['review']
  readonly regeneration: ReviewWiring['regeneration']
  readonly queue: Queue
  close(): Promise<void>
}

/**
 * 出来事の配信先（Phase 5.8b）。**実体は `packages/events` が持ち、main.ts が注入する。**
 * 未注入のあいだは何も届かないので、握り潰さず warn を出す口を使う（`generation/events.ts`）。
 */
export const createGenerationWiring = (
  config: AppConfig,
  connection: Redis,
  logger: Logger,
  stubOutputDir: string,
  events?: ProjectEventPublisher,
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
  /**
   * 生成物を media キューへ回すための口。probe とサムネイル、そして
   * 次の Shot が使う最終フレームはこの経路でしか作られない。
   */
  const mediaQueue = new Queue(QUEUE_NAMES.media, { connection })

  /** ポーリングの再スケジュールは BullMQ の delay で行う。repeatable job は使わない。 */
  const scheduler: PollScheduler = {
    reschedule: async (data, delayMs) => {
      await queue.add('generate', data, { delay: delayMs })
    },
  }

  const registry = createProviderRegistry([
    createStubVideoProvider({
      outputDir: stubOutputDir,
      // 0 以外にすると失敗の経路を実際に走らせられる（`STUB_VIDEO_FAILURE_RATE`）。
      failureRate: config.providers.stubVideoFailureRate,
    }),
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
    mediaQueue: {
      enqueue: async (mediaAssetId) => {
        await mediaQueue.add('process', { mediaAssetId })
      },
    },
    events: events ?? createUnwiredEventPublisher(logger),
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
    /**
     * 出力の probe・サムネイル・ポスターフレームはこの経路でしか作られない。
     * 以前は投入していなかったため、レンダリング結果には何も付いていなかった。
     */
    mediaQueue: {
      enqueue: async (mediaAssetId) => {
        await mediaQueue.add('process', { mediaAssetId })
      },
    },
    logger,
  }

  /**
   * 音楽解析（ADR-0009）。解析本体は apps/audio（Python / librosa）が行い、
   * worker は音源を AUDIO_ROOT 配下へ置いて相対パスを渡すだけ。
   * **AUDIO_ROOT は apps/audio 側と同じディレクトリを指すこと。**
   */
  const analysis: AnalysisProcessorDeps = {
    musicTracks: createMusicTrackRepository(db),
    musicAnalyses: createMusicAnalysisRepository(db),
    mediaAssets: createMediaAssetRepository(db),
    storage,
    analyzer: createMusicAnalyzer(config.audio.url),
    audioRoot: process.env.AUDIO_ROOT ?? '/tmp/ixa-audio',
    logger,
  }

  /**
   * レビューと再生成。review が fail を出したら regeneration キューへ回し、
   * 再生成が通ったら generation キューへ戻る。**判定はしない。積むだけ。**
   */
  const regenerationQueue = new Queue(QUEUE_NAMES.regeneration, { connection })
  const reviewWiring = createReviewWiring(db, storage, logger, {
    regeneration: {
      enqueue: async (takeId) => {
        await regenerationQueue.add('regenerate', { takeId })
      },
    },
    /**
     * 再生成が許可されたときに実際の生成を積む口。
     * 仕様のコンパイルと GenerationJob 行の作成が要るので、`regeneration-wiring.ts` に分けた。
     */
    generation: createRegenerationEnqueue({
      db,
      context: deps.context,
      registry,
      queue,
      logger,
    }),
  })

  return {
    deps,
    media,
    render,
    analysis,
    review: reviewWiring.review,
    regeneration: reviewWiring.regeneration,
    queue,
    close: async () => {
      await queue.close()
      await mediaQueue.close()
      await regenerationQueue.close()
      await db.$client.end()
    },
  }
}
