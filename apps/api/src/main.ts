import { join } from 'node:path'
import { serve, type ServerType } from '@hono/node-server'
import { describeEnvironment, getConfig } from '@ixa/config'
import {
  closeDbClient,
  createDbClient,
  createGenerationJobRepository,
  createMediaAssetRepository,
  createProjectRepository,
  createShotRepository,
  createTakeRepository,
  type DbClient,
  createMusicTrackRepository,
  createRenderJobRepository,
  createTextStyleRepository,
  createTimelineClipRepository,
  createTransitionRepository,
  createBrandAssetRepository,
  createCharacterLookRepository,
  createCharacterRepository,
  createLocationRepository,
  createShotCharacterRepository,
  createShotReferenceRepository,
  createImageJobRepository,
  createScriptRepository,
  createEditBatchRepository,
  createStoryboardDraftRepository,
  createSequenceRepository,
  createMusicAnalysisRepository,
  createMusicAnalysisFailureRepository,
  createReviewRepository,
  findActiveGenerationJobs,
} from '@ixa/db'
import { createProviderRegistry } from '@ixa/provider-core'
import { createGenerationContextSource } from '@ixa/generation'
import { RENDER_QUEUE_NAME, type RenderQueue } from './routes/renders.js'
import { ANALYSIS_QUEUE_NAME, type AnalysisQueue } from './routes/music.js'
import { REVIEW_QUEUE_NAME, type ReviewQueue } from './routes/reviews.js'
import type { MediaIngestDeps } from './routes/uploads.js'
import {
  createFalVideoProvider,
  createLocalImageToVideoProvider,
  createStubVideoProvider,
  createVpipeVideoProvider,
} from '@ixa/provider-video'
import { createS3Storage } from '@ixa/storage'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { createRedisProjectEvents } from '@ixa/events'
import { createAiWiring } from './ai/ai-wiring.js'
import { createApp } from './app.js'
import { createLogger, type Logger } from './logger.js'
import { GENERATION_QUEUE_NAME, type GenerationQueue } from './routes/shots.js'
import { IMAGE_QUEUE_NAME, type ImageJobQueue } from './routes/shot-start-frame-generate.js'

/** graceful shutdown の上限時間（ミリ秒）。超過したら強制終了する。 */
const SHUTDOWN_TIMEOUT_MS = 30_000

/** HTTP サーバを閉じる。新規接続を止め、処理中のリクエストの完了を待つ。 */
const closeServer = (server: ServerType): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(new Error(`HTTP サーバの終了に失敗しました: ${error.message}`, { cause: error }))
        return
      }
      resolve()
    })
  })

/** サーバ → キュー → DB の順に閉じる。timeoutMs を超えたら 'timeout' を返す。 */
const closeAllWithTimeout = async (
  server: ServerType,
  db: DbClient,
  queue: Queue,
  timeoutMs: number,
  /** サーバの次、キューの前に閉じるもの（出来事の配信など）。 */
  onClose: () => Promise<void> = async () => {},
): Promise<'closed' | 'timeout'> => {
  const closeAll = (async (): Promise<'closed'> => {
    await closeServer(server)
    await onClose()
    await queue.close()
    await closeDbClient(db)
    return 'closed'
  })()

  const timeout = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), timeoutMs)
  })

  return Promise.race([closeAll, timeout])
}

/**
 * SIGINT / SIGTERM を受けたらサーバと DB 接続を閉じてから終了する。
 * 二重に走らないようフラグで守る。
 */
const registerShutdownHandlers = (
  server: ServerType,
  db: DbClient,
  queue: Queue,
  logger: Logger,
  onClose: () => Promise<void> = async () => {},
): void => {
  let shuttingDown = false

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true

    logger.info({ signal }, 'シャットダウンを開始します')

    closeAllWithTimeout(server, db, queue, SHUTDOWN_TIMEOUT_MS, onClose)
      .then((result) => {
        if (result === 'timeout') {
          logger.error(
            { timeoutMs: SHUTDOWN_TIMEOUT_MS },
            'graceful shutdown がタイムアウトしたため強制終了します',
          )
          process.exit(1)
        }

        logger.info('シャットダウンが完了しました')
        process.exit(0)
      })
      .catch((error: unknown) => {
        logger.error({ error }, 'シャットダウン中にエラーが発生しました')
        process.exit(1)
      })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

/**
 * api の起動処理。副作用はすべてこの関数に閉じ込め、明示的に呼び出す。
 * 同期処理のみのため async にはしない。
 */
export const main = (): void => {
  const config = getConfig()
  const logger = createLogger(config.logLevel)

  const db = createDbClient(config.database.url)
  const storage = createS3Storage(config.s3)

  // ジョブデータは ID のみ。実データは worker が DB から読む（ADR-0008）。
  const connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null })
  /**
   * Project の出来事（生成の状態など）を流す・受ける口（PHASE 5.8b）。
   * 購読は専用の接続が要るので、キュー用の接続を複製して使う。
   */
  const projectEvents = createRedisProjectEvents({ connection })
  const generationQueue = new Queue(GENERATION_QUEUE_NAME, { connection })
  const queuePort: GenerationQueue = {
    enqueue: async (generationJobId) => {
      await generationQueue.add('generate', { generationJobId })
    },
  }

  const renderQueue = new Queue(RENDER_QUEUE_NAME, { connection })
  const renderQueuePort: RenderQueue = {
    enqueue: async (renderJobId) => {
      await renderQueue.add('render', { renderJobId })
    },
  }

  const analysisQueue = new Queue(ANALYSIS_QUEUE_NAME, { connection })
  const analysisQueuePort: AnalysisQueue = {
    enqueue: async (musicTrackId) => {
      await analysisQueue.add('analyze', { musicTrackId })
    },
  }

  const reviewQueue = new Queue(REVIEW_QUEUE_NAME, { connection })
  const reviewQueuePort: ReviewQueue = {
    enqueue: async (takeId) => {
      await reviewQueue.add('review', { takeId })
    },
  }

  // 絵コンテの画像（ADR-0029）。どの口で作るかは IMAGE_PROVIDER（既定スタブ）。作るのは worker。
  const imageQueue = new Queue(IMAGE_QUEUE_NAME, { connection })
  const imageQueuePort: ImageJobQueue = {
    enqueue: async (imageJobId) => {
      await imageQueue.add('draw', { imageJobId })
    },
  }

  // キュー名は apps/worker/src/queues.ts の QUEUE_NAMES と一致させること。
  // apps 同士を import できないため、文字列で合わせるしかない。
  const mediaQueue = new Queue('media', { connection })
  const mediaIngest: MediaIngestDeps = {
    queue: {
      enqueue: async (mediaAssetId) => {
        await mediaQueue.add('process', { mediaAssetId })
      },
    },
    logger,
  }

  /**
   * リポジトリは 1 箇所で作る。生成コンテキストと API の両方が同じ実体を使う。
   */
  const characters = createCharacterRepository(db)
  const looks = createCharacterLookRepository(db)
  const shotCharacters = createShotCharacterRepository(db)
  const shotReferences = createShotReferenceRepository(db)
  const brandAssets = createBrandAssetRepository(db)
  const locations = createLocationRepository(db)
  const shots = createShotRepository(db)
  const takes = createTakeRepository(db)
  const mediaAssets = createMediaAssetRepository(db)

  const ai = createAiWiring(config, db)
  const app = createApp({
    // 鍵の設定状態だけを返す口。**値は渡さない**（`describeEnvironment` が落とす）。
    environment: { status: () => describeEnvironment(config) },
    // 使う AI（ADR-0032）。見つかった AI と、用途ごとの選択。
    ai,
    // 生成中の Shot で、いま何が起きているか（モデル・順番待ちか作成中か・経過）。
    activeGenerations: (projectId) => findActiveGenerationJobs(db, projectId),
    projects: createProjectRepository(db),
    mediaAssets,
    shots,
    takes,
    generationJobs: createGenerationJobRepository(db),
    transitions: createTransitionRepository(db),
    timelineClips: createTimelineClipRepository(db),
    textStyles: createTextStyleRepository(db),
    musicTracks: createMusicTrackRepository(db),
    renderJobs: createRenderJobRepository(db),
    renderQueue: renderQueuePort,
    characters,
    looks,
    shotCharacters,
    shotReferences,
    brandAssets,
    locations,
    scripts: createScriptRepository(db),
    storyboardDrafts: createStoryboardDraftRepository(db),
    editBatches: createEditBatchRepository(db),
    // 絵コンテの案の口は「使う AI」のテキストで決まる（ADR-0032。未選択なら STORYBOARD_DRAFTER）。
    storyboardDrafter: ai.storyboardDrafter,
    sequences: createSequenceRepository(db),
    musicAnalyses: createMusicAnalysisRepository(db),
    musicAnalysisFailures: createMusicAnalysisFailureRepository(db),
    analysisQueue: analysisQueuePort,
    reviews: createReviewRepository(db),
    reviewQueue: reviewQueuePort,
    mediaIngest,
    // Provider の登録はここでのみ行う。Phase 1 はスタブのみ（ADR-0014）。
    // API 側は capability の参照と Model Router のためだけに使い、実行は worker が行う。
    registry: createProviderRegistry([
      createStubVideoProvider({ outputDir: process.env.STUB_OUTPUT_DIR ?? '/tmp/ixa-stub-output' }),
      // worker と同じ一覧にする（API はモデル一覧・見積り・検証のためだけに使う）。ADR-0025。
      createLocalImageToVideoProvider({
        outputDir: join(process.env.STUB_OUTPUT_DIR ?? '/tmp/ixa-stub-output', 'local'),
      }),
      // fal（従量課金）。worker と同じ条件（VIDEO_PROVIDER=fal と鍵）で登録する。作るだけでは通信しない。
      // 登録していなかったため、モデル一覧に出ず、選んでも AUTO が見つけられなかった（ADR-0032）。
      ...(config.providers.videoProvider === 'fal' && config.providers.falApiKey !== null
        ? [createFalVideoProvider({ apiKey: config.providers.falApiKey })]
        : []),
      // 手元の生成サーバの MiniMax H3（ADR-0031）。worker と同じ条件で登録する（作るだけでは通信しない）。
      ...(config.providers.localVideoGenerator === 'vpipe'
        ? [
            createVpipeVideoProvider({
              baseUrl: config.providers.vpipeApiUrl,
              ...(config.providers.vpipeApiToken === null ? {} : { token: config.providers.vpipeApiToken }),
              outputDir: join(process.env.STUB_OUTPUT_DIR ?? '/tmp/ixa-stub-output', 'vpipe'),
            }),
          ]
        : []),
    ]),
    /**
     * Phase 2 で空実装から差し替えた。
     * Shot に紐づいた登場人物・Look・識別画像・衣装画像を実際に解決する。
     */
    generationContext: createGenerationContextSource({
      shotCharacters,
      characters,
      looks,
      locations,
      shotReferences,
      shots,
      takes,
      mediaAssets,
    }),
    generationQueue: queuePort,
    imageJobs: createImageJobRepository(db),
    imageQueue: imageQueuePort,
    // Shot の絵の口は「使う AI」の画像で決まる（ADR-0032。未選択なら IMAGE_PROVIDER）。
    imageModel: ai.imageModel,
    // 動画の AUTO は「使う AI」の動画の中から選ぶ（ADR-0032）。
    videoProvider: ai.videoProvider,
    storage,
    corsOrigins: config.corsOrigins,
    events: {
      publish: projectEvents.publisher.publish,
      subscribe: projectEvents.subscriber.subscribe,
    },
    logger,
  })

  /**
   * **既定は `127.0.0.1`。** この API には認証が無いので、既定で外に開かない。
   * LAN から触るときだけ `API_HOST=0.0.0.0` にし、終わったら戻す。
   */
  const server = serve(
    { fetch: app.fetch, port: config.api.port, hostname: config.api.host },
    (info) => {
      logger.info({ port: info.port, host: config.api.host }, 'api を起動しました')
      if (config.api.host !== '127.0.0.1' && config.api.host !== 'localhost') {
        logger.warn(
          { host: config.api.host },
          '認証の無い API をこのマシンの外へ公開している。検証が終わったら API_HOST を戻すこと',
        )
      }
    },
  )

  registerShutdownHandlers(server, db, generationQueue, logger, () => projectEvents.close())
}

try {
  main()
} catch (error) {
  process.exitCode = 1
  process.stderr.write(`api の起動に失敗しました: ${String(error)}\n`)
}
