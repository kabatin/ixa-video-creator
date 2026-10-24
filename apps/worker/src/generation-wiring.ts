import { extractFrameByIndex, normalizeProgramLoudness, upscaleForRender } from '@ixa/media'
import { join } from 'node:path'
import { createProviderRegistry } from '@ixa/provider-core'
import { createContinuityFrameSource, createGenerationContextSource } from '@ixa/generation'
import {
  createFalVideoProvider,
  createLocalImageToVideoProvider,
  createLocalVideoProviders,
  createStubVideoProvider,
} from '@ixa/provider-video'
import { continuityFrameKey, createStorage } from '@ixa/storage'
import {
  createAiSettingsRepository,
  createDbClient,
  createGenerationJobRepository,
  createMediaAssetRepository,
  createMusicAnalysisRepository,
  createMusicAnalysisFailureRepository,
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
  type DbClient,
} from '@ixa/db'
import {
  ProviderId as ProviderIdSchema,
  type AiToolId,
  aiDefaultsFromEnv,
  resolveAiSettings,
  type ProjectEventPublisher,
  type ProviderId,
} from '@ixa/domain'
import type { AppConfig } from '@ixa/config'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Logger } from 'pino'
import { createRemotionRenderer } from '@ixa/render'
import { createMusicAnalyzer } from '@ixa/music'
import type { AnalysisProcessorDeps } from './analysis/index.js'
import {
  createRedisLocalGpuLease,
  createUnwiredEventPublisher,
  type GenerationProcessorDeps,
  type MediaJobQueue,
  type PollScheduler,
} from './generation/index.js'
import type { MediaProcessorDeps } from './media/index.js'
import type { RenderProcessorDeps } from './render/index.js'
import { createMediaPreparer } from './render/prepare-media.js'
import { createReviewWiring, type ReviewWiring } from './review-wiring.js'
import { reviewWhenAutoRetake } from './review/auto-review.js'
import { createImageWiring } from './image-wiring.js'
import { createUpscaleWiring } from './upscale-wiring.js'
import type { UpscaleProcessorDeps } from './upscale/index.js'
import type { ImageProcessorDeps } from './image/index.js'
import type { VoiceProcessorDeps } from './voice/index.js'
import type { MusicProcessorDeps } from './music/index.js'
import { createMusicWiring } from './music-wiring.js'
import type { SfxProcessorDeps } from './sfx/index.js'
import { createSfxWiring } from './sfx-wiring.js'
import type { MotionProcessorDeps } from './motion/index.js'
import { createMotionWiring } from './motion-wiring.js'
import { createThumbnailWiring } from './thumbnail-wiring.js'
import type { ThumbnailProcessorDeps } from './thumbnail/index.js'
import { createVoiceWiring } from './voice-wiring.js'
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
  /** 絵コンテの画像（ADR-0029）。 */
  readonly image: ImageProcessorDeps
  /** ナレーションの声と文字起こし（ADR-0038）。 */
  readonly voice: VoiceProcessorDeps
  /** 曲を作る（ADR-0048）。 */
  readonly music: MusicProcessorDeps
  /** 効果音を作る（ADR-0052）。 */
  readonly sfx: SfxProcessorDeps
  /** Take の動きの分析（ADR-0054）。 */
  readonly motion: MotionProcessorDeps
  /**
   * 解像度を上げる（ADR-0044）。**この機械に上げる口が無ければ null。**
   * 無いことを `undefined` ではなく `null` で表す（配線し忘れと区別するため）。
   */
  readonly upscale: UpscaleProcessorDeps | null
  /** YouTube のサムネイル（ADR-0051）。 */
  readonly thumbnail: ThumbnailProcessorDeps
  readonly queue: Queue
  close(): Promise<void>
}

/**
 * 出来事の配信先（Phase 5.8b）。**実体は `packages/events` が持ち、main.ts が注入する。**
 * 未注入のあいだは何も届かないので、握り潰さず warn を出す口を使う（`generation/events.ts`）。
 */
/**
 * `VIDEO_PROVIDER=fal` なのに鍵が無ければ、**起動時に止める**。
 *
 * 黙ってスタブへ落とすと、実 Provider で作ったつもりの色の四角が Take として残り、
 * 気付くのは書き出しを見たときになる。**設定と実態が食い違ったまま動かさない。**
 */
/**
 * いま選んでいる AI（ADR-0032）。**読むたびに DB を見る**（画面で選び直したら次の 1 回から効く）。
 * まだ選んでいなければ、API と同じ初期値（`aiDefaultsFromEnv`）。
 */
const chosenAi = (config: AppConfig, db: DbClient) => {
  const settings = createAiSettingsRepository(db)
  const defaults = aiDefaultsFromEnv({ storyboardDrafter: config.storyboardDrafter, imageProvider: config.imageProvider })
  return async () => resolveAiSettings(await settings.get(), defaults).settings
}

/** いま選んでいる動画の AI。AUTO はこの中から選ぶ。 */
const chosenVideoProvider = (config: AppConfig, db: DbClient) => {
  const chosen = chosenAi(config, db)
  return async (): Promise<ProviderId> => ProviderIdSchema.parse((await chosen()).video)
}

/** いま選んでいるテキストの AI。自動レビューの vision 判定に使う（Claude なら画像を見る Claude）。 */
const chosenTextTool = (config: AppConfig, db: DbClient) => {
  const chosen = chosenAi(config, db)
  return async (): Promise<AiToolId> => (await chosen()).text
}

const requireFalApiKey = (config: AppConfig): string => {
  const key = config.providers.falApiKey
  if (key === null || key.trim() === '') {
    throw new Error(
      'VIDEO_PROVIDER=fal が指定されていますが FAL_API_KEY がありません。' +
        '鍵を .env に設定して再起動するか、VIDEO_PROVIDER=stub に戻してください。',
    )
  }
  return key
}

export const createGenerationWiring = (
  config: AppConfig,
  connection: Redis,
  logger: Logger,
  stubOutputDir: string,
  events?: ProjectEventPublisher,
): GenerationWiring => {
  const db = createDbClient(config.database.url)

  // 置き場の選び方は API と同じ関数に任せる（片方だけ fs になる食い違いを作らない。ADR-0041）。
  const { storage } = createStorage(config.storage)

  const queue = new Queue(QUEUE_NAMES.generation, { connection })
  /**
   * 生成物を media キューへ回すための口。probe とサムネイル、そして
   * 次の Shot が使う最終フレームはこの経路でしか作られない。
   */
  const mediaQueue = new Queue(QUEUE_NAMES.media, { connection })
  /** 手元の GPU の順番待ちの絵を積み直す先（ADR-0047）。 */
  const imageQueue = new Queue(QUEUE_NAMES.image, { connection })
  /** 順番待ちの曲を積み直す先と、できた楽曲を解析に回す先（ADR-0048）。 */
  const musicQueue = new Queue(QUEUE_NAMES.music, { connection })
  const analysisQueue = new Queue(QUEUE_NAMES.analysis, { connection })
  /** 順番待ちの効果音を積み直す先（ADR-0052）。 */
  const sfxQueue = new Queue(QUEUE_NAMES.sfx, { connection })
  /** 自動の作り直しを選んだ Take のレビューを積む先（ADR-0057）。 */
  const reviewQueue = new Queue(QUEUE_NAMES.review, { connection })

  /** ポーリングの再スケジュールは BullMQ の delay で行う。repeatable job は使わない。 */
  const scheduler: PollScheduler = {
    reschedule: async (data, delayMs) => {
      await queue.add('generate', data, { delay: delayMs })
    },
  }

  /**
   * スタブは**常に登録する。** 過去に投入したスタブのジョブを問い合わせるのに要る
   * （外すと `providerFor` が「未登録のモデル」で落ち、走っている生成が捨てられる）。
   */
  const stub = createStubVideoProvider({
    outputDir: stubOutputDir,
    // 0 以外にすると失敗の経路を実際に走らせられる（`STUB_VIDEO_FAILURE_RATE`）。
    failureRate: config.providers.stubVideoFailureRate,
    // 0 以外にすると予算ガードを無料で試せる（`STUB_VIDEO_COST_PER_SEC`）。
    costPerSecondUsd: config.providers.stubVideoCostPerSecUsd,
  })

  /**
   * 実 Provider は `VIDEO_PROVIDER=fal` のときだけ登録する。**既定はスタブで無料。**
   *
   * **鍵の有無で切り替えない。** 別の理由で `FAL_API_KEY` を置いた瞬間に
   * 課金経路が開くのは事故のもと。
   * `fal` を選んだのに鍵が無ければ**起動時に止める**。黙ってスタブへ落とすと、
   * 実 Provider で作ったつもりの色の四角が Take として残り、気付くのがずっと後になる。
   */
  const registry = createProviderRegistry([
    stub,
    // 最初のフレームの画像を動かすローカルの画像→動画（ADR-0025）。無料・鍵不要なので常に登録する。
    createLocalImageToVideoProvider({ outputDir: join(stubOutputDir, 'local') }),
    ...(config.providers.videoProvider === 'fal'
      ? [createFalVideoProvider({ apiKey: requireFalApiKey(config) })]
      : []),
    /**
     * 手元の生成サーバ（vpipe-api の MiniMax H3・wan-api の Wan 2.2。ADR-0031 / 0040）。
     * `LOCAL_VIDEO_GENERATOR` に書いたものだけ登録する。AUTO には選ばれない（`routable: false`）。
     *
     * **登録の条件は Provider 側の表が持つ**（`localVideoServerWirings`）。以前はこの条件が
     * API 側にも書き写されていて、片方だけ直すと「一覧には出るのに worker が未登録と言う」になった。
     */
    ...createLocalVideoProviders({
      enabled: config.providers.localVideoGenerators,
      vpipe: { baseUrl: config.providers.vpipeApiUrl, token: config.providers.vpipeApiToken },
      wan: { baseUrl: config.providers.wanApiUrl, token: config.providers.wanApiToken },
      outputRoot: stubOutputDir,
      // 掃除・控えの失敗は生成を止めないが、黙って捨てない（PR #4 レビュー #5）。
      warn: (detail, message) => {
        logger.warn(detail, message)
      },
    }),
  ])

  /**
   * 素材を計測する口（幅・高さ・fps・サムネイル・最後のコマ）。
   * **生成と解像度上げで同じ 1 つを使う。** 別に作ると同じ素材が二重に計測される。
   */
  const mediaQueuePort: MediaJobQueue = {
    enqueue: async (mediaAssetId) => {
      await mediaQueue.add('process', { mediaAssetId })
    },
  }

  /**
   * この機械の GPU の順番（整理券。ADR-0040 / 0044）。
   * **生成と解像度上げで同じ 1 つを使う。** 別々に作ると、同じ GPU を 2 つの列が取り合う。
   */
  const localGpuLease = createRedisLocalGpuLease({ connection })

  /**
   * 解像度を上げる口（ADR-0044）。**順番は生成と共有する**ので、同じ借り（`localGpuLease`）を渡す。
   * vpipe の URL が無ければ null（この機械には上げる口が無い）。
   */
  const upscaleWiring = createUpscaleWiring({
    db,
    connection,
    storage,
    localGpuLease,
    mediaQueue: mediaQueuePort,
    logger,
    outputRoot: stubOutputDir,
    vpipe: { baseUrl: config.providers.vpipeApiUrl, token: config.providers.vpipeApiToken },
  })

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
      // 前の Shot が画面に出す最後のコマ（2026-10-24）。**API と同じ口を配線する**（違うと spec_drift）。
      continuityFrames: createContinuityFrameSource({
        mediaAssets: createMediaAssetRepository(db),
        storage,
        extractFrame: (input, output, index) => extractFrameByIndex(input, output, index),
        frameKey: continuityFrameKey,
      }),
    }),
    scheduler,
    mediaQueue: mediaQueuePort,
    /**
     * この機械の GPU を 1 本ずつに揃える（ADR-0040）。**置き場はキューと同じ Redis。**
     * プロセスの中のミューテックスでは worker を 2 つ立てた時点で効かない。
     */
    localGpuLease,
    events: events ?? createUnwiredEventPublisher(logger),
    logger,
  }

  const media: MediaProcessorDeps = {
    mediaAssets: createMediaAssetRepository(db),
    storage,
    workDir: process.env.MEDIA_WORK_DIR ?? '/tmp/ixa-media-work',
    logger,
    // 自動の作り直しを選んだ Take は、取り込みが済んだらレビューを積む（ADR-0057）。Take ごとに 1 つにまとめる。
    afterIngested: reviewWhenAutoRetake({
      takes: createTakeRepository(db),
      reviewQueue: {
        enqueue: async (takeId) => {
          await reviewQueue.add('review', { takeId }, { jobId: `auto-review-${takeId}`, removeOnComplete: true, removeOnFail: true })
        },
      },
      logger,
    }),
  }

  const renderMediaAssets = createMediaAssetRepository(db)
  const render: RenderProcessorDeps = {
    renderJobs: createRenderJobRepository(db),
    mediaAssets: renderMediaAssets,
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
    // 書き出しの音量を -14 LUFS に揃える（ADR-0039）。
    normalizeLoudness: normalizeProgramLoudness,
    // 枠より小さい映像は、Chrome に拡大させず先に Lanczos で拡大する（ADR-0045 段 3）。
    prepareMedia: createMediaPreparer({
      mediaAssets: renderMediaAssets,
      storage,
      upscale: upscaleForRender,
      logger,
    }),
  }

  /**
   * 音楽解析（ADR-0009）。解析本体は apps/audio（Python / librosa）が行い、
   * worker は音源を AUDIO_ROOT 配下へ置いて相対パスを渡すだけ。
   * **AUDIO_ROOT は apps/audio 側と同じディレクトリを指すこと。**
   */
  const analysis: AnalysisProcessorDeps = {
    musicTracks: createMusicTrackRepository(db),
    musicAnalyses: createMusicAnalysisRepository(db),
    analysisFailures: createMusicAnalysisFailureRepository(db),
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
  const reviewWiring = createReviewWiring(db, storage, logger, chosenTextTool(config, db), {
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
      videoProvider: chosenVideoProvider(config, db),
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
    image: createImageWiring({
      db,
      storage,
      context: deps.context,
      mediaQueue: deps.mediaQueue,
      events: deps.events,
      logger,
      stubOutputDir,
      klein: {
        enabled: config.providers.localImageGenerators.includes('klein'),
        baseUrl: config.providers.kleinApiUrl,
        token: config.providers.kleinApiToken,
      },
      localGpuLease,
      imageQueue,
      // 作った絵のチェック（ADR-0055）。文章の AI が Claude のときだけ見る。上限は設定から。
      textTool: chosenTextTool(config, db),
      maxRetries: config.imageCheckMaxRetries,
      checkModel: config.imageCheckModel,
    }),
    voice: createVoiceWiring({ config, db, storage, mediaQueue: deps.mediaQueue, events: deps.events, logger }),
    music: createMusicWiring({
      db,
      storage,
      mediaQueue: deps.mediaQueue,
      events: deps.events,
      logger,
      outputRoot: stubOutputDir,
      aceStep: {
        enabled: config.providers.localMusicGenerators.includes('ace_step'),
        baseUrl: config.providers.aceStepApiUrl,
        token: config.providers.aceStepApiToken,
      },
      sfxApi: {
        enabled: config.providers.localSfxGenerators.includes('sfx_api'),
        baseUrl: config.providers.sfxApiUrl,
        token: config.providers.sfxApiToken,
      },
      localGpuLease,
      musicQueue,
      analysisQueue,
    }),
    sfx: createSfxWiring({
      db,
      storage,
      mediaQueue: deps.mediaQueue,
      events: deps.events,
      logger,
      outputRoot: stubOutputDir,
      sfxApi: {
        enabled: config.providers.localSfxGenerators.includes('sfx_api'),
        baseUrl: config.providers.sfxApiUrl,
        token: config.providers.sfxApiToken,
      },
      localGpuLease,
      sfxQueue,
    }),
    motion: createMotionWiring({
      db,
      storage,
      logger,
      textTool: chosenTextTool(config, db),
      model: config.motionAnalysisModel,
    }),
    upscale: upscaleWiring?.deps ?? null,
    thumbnail: createThumbnailWiring({ db, storage, mediaQueue: render.mediaQueue, logger }),
    queue,
    close: async () => {
      await queue.close()
      await upscaleWiring?.queue.close()
      await mediaQueue.close()
      await imageQueue.close()
      await musicQueue.close()
      await sfxQueue.close()
      await reviewQueue.close()
      await analysisQueue.close()
      await regenerationQueue.close()
      await db.$client.end()
    },
  }
}
