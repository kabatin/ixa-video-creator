import { serve, type ServerType } from '@hono/node-server'
import { getConfig } from '@ixa/config'
import { closeDbClient, createDbClient, createProjectRepository, type DbClient } from '@ixa/db'
import { createApp } from './app.js'
import { createLogger, type Logger } from './logger.js'

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

/** サーバ → DB の順に閉じる。timeoutMs を超えたら 'timeout' を返す。 */
const closeAllWithTimeout = async (
  server: ServerType,
  db: DbClient,
  timeoutMs: number,
): Promise<'closed' | 'timeout'> => {
  const closeAll = (async (): Promise<'closed'> => {
    await closeServer(server)
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
const registerShutdownHandlers = (server: ServerType, db: DbClient, logger: Logger): void => {
  let shuttingDown = false

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true

    logger.info({ signal }, 'シャットダウンを開始します')

    closeAllWithTimeout(server, db, SHUTDOWN_TIMEOUT_MS)
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
  const app = createApp({ projects: createProjectRepository(db), logger })

  const server = serve({ fetch: app.fetch, port: config.api.port }, (info) => {
    logger.info({ port: info.port }, 'api を起動しました')
  })

  registerShutdownHandlers(server, db, logger)
}

try {
  main()
} catch (error) {
  process.exitCode = 1
  process.stderr.write(`api の起動に失敗しました: ${String(error)}\n`)
}
