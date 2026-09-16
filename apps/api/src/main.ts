import { serve, type ServerType } from '@hono/node-server'
import { getConfig } from '@ixa/config'
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
  createTimelineClipRepository,
  createTransitionRepository,
  createBrandAssetRepository,
  createCharacterLookRepository,
  createCharacterRepository,
  createLocationRepository,
  createShotCharacterRepository,
  createShotReferenceRepository,
  createScriptRepository,
  createSequenceRepository,
  createMusicAnalysisRepository,
} from '@ixa/db'
import { createProviderRegistry } from '@ixa/provider-core'
import { createGenerationContextSource } from '@ixa/generation'
import { RENDER_QUEUE_NAME, type RenderQueue } from './routes/renders.js'
import { ANALYSIS_QUEUE_NAME, type AnalysisQueue } from './routes/music.js'
import type { MediaIngestDeps } from './routes/uploads.js'
import { createStubVideoProvider } from '@ixa/provider-video'
import { createS3Storage } from '@ixa/storage'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { createApp } from './app.js'
import { createLogger, type Logger } from './logger.js'
import { GENERATION_QUEUE_NAME, type GenerationQueue } from './routes/shots.js'

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
): Promise<'closed' | 'timeout'> => {
  const closeAll = (async (): Promise<'closed'> => {
    await closeServer(server)
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
): void => {
  let shuttingDown = false

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true

    logger.info({ signal }, 'シャットダウンを開始します')

    closeAllWithTimeout(server, db, queue, SHUTDOWN_TIMEOUT_MS)
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

  const app = createApp({
    projects: createProjectRepository(db),
    mediaAssets,
    shots,
    takes,
    generationJobs: createGenerationJobRepository(db),
    transitions: createTransitionRepository(db),
    timelineClips: createTimelineClipRepository(db),
    musicTracks: createMusicTrackRepository(db),
    renderJobs: createRenderJobRepository(db),
    renderQueue: renderQueuePort,
    characters,
    looks,
    shotCharacters,
    brandAssets,
    locations,
    scripts: createScriptRepository(db),
    sequences: createSequenceRepository(db),
    musicAnalyses: createMusicAnalysisRepository(db),
    analysisQueue: analysisQueuePort,
    mediaIngest,
    // Provider の登録はここでのみ行う。Phase 1 はスタブのみ（ADR-0014）。
    // API 側は capability の参照と Model Router のためだけに使い、実行は worker が行う。
    registry: createProviderRegistry([
      createStubVideoProvider({ outputDir: process.env.STUB_OUTPUT_DIR ?? '/tmp/ixa-stub-output' }),
    ]),
    /**
     * Phase 2 で空実装から差し替えた。
     * Shot に紐づいた登場人物・Look・識別画像・衣装画像を実際に解決する。
     */
    generationContext: createGenerationContextSource({
      shotCharacters, characters, looks, locations, shotReferences,
      shots, takes, mediaAssets,
    }),
    generationQueue: queuePort,
    storage,
    corsOrigins: config.corsOrigins,
    logger,
  })

  const server = serve({ fetch: app.fetch, port: config.api.port }, (info) => {
    logger.info({ port: info.port }, 'api を起動しました')
  })

  registerShutdownHandlers(server, db, generationQueue, logger)
}

try {
  main()
} catch (error) {
  process.exitCode = 1
  process.stderr.write(`api の起動に失敗しました: ${String(error)}\n`)
}
