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
} from '@ixa/db'
import { createPhase1EmptyContextSource } from '@ixa/domain'
import { createProviderRegistry } from '@ixa/provider-core'
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

  const app = createApp({
    projects: createProjectRepository(db),
    mediaAssets: createMediaAssetRepository(db),
    shots: createShotRepository(db),
    takes: createTakeRepository(db),
    generationJobs: createGenerationJobRepository(db),
    // TODO: スタブ Provider（packages/providers/video）の配線は別タスク。
    // 登録が空のあいだ AUTO は「利用できるモデルがありません」で 422 になる。
    registry: createProviderRegistry([]),
    // TODO: Character / Location リポジトリは Phase 2。それまでは空実装で通す。
    generationContext: createPhase1EmptyContextSource(),
    generationQueue: queuePort,
    storage,
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
