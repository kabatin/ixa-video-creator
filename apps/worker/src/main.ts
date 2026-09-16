import { getConfig } from '@ixa/config'
import { Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Logger } from 'pino'
import { createRedisConnection } from './connection.js'
import { createLogger } from './logger.js'
import { processNoopJob, type NoopJobData, type NoopJobResult } from './processors/noop.js'
import { QUEUE_CONFIGS, QUEUE_NAMES, resolveQueueConfigs, type QueueConfig } from './queues.js'
import { createGenerationWiring, type GenerationWiring } from './generation-wiring.js'
import { processGenerationJob } from './generation/index.js'

/** graceful shutdown の既定タイムアウト（ミリ秒）。超過したら強制終了する。 */
const SHUTDOWN_TIMEOUT_MS = 30_000

type NoopWorker = Worker<NoopJobData, NoopJobResult>

/**
 * 解決済みのキュー設定から、各キューの Worker を起動する。
 * Phase 0 では全キューが疎通確認用の noop プロセッサを使う。
 */
const createWorkers = (
  queueConfigs: readonly QueueConfig[],
  connection: Redis,
  logger: Logger,
  generation: GenerationWiring,
): readonly NoopWorker[] =>
  queueConfigs.map((config) => {
    // generation キューだけは実処理を担当する。他は Phase 1 時点では noop のまま。
    const handler =
      config.name === QUEUE_NAMES.generation
        ? async (job: { data: unknown }): Promise<NoopJobResult> => {
            const outcome = await processGenerationJob(generation.deps, job.data)
            return { echoed: outcome.state, processedAt: new Date().toISOString() }
          }
        : async (job: { data: NoopJobData }): Promise<NoopJobResult> => processNoopJob(job.data)

    const worker: NoopWorker = new Worker<NoopJobData, NoopJobResult>(
      config.name,
      handler,
      { connection, concurrency: config.concurrency },
    )

    worker.on('completed', (job) => {
      logger.debug({ queue: config.name, jobId: job.id }, 'ジョブが完了しました')
    })

    worker.on('failed', (job, error) => {
      logger.error(
        { queue: config.name, jobId: job?.id, error: error.message },
        'ジョブが失敗しました',
      )
    })

    return worker
  })

/**
 * すべての Worker を閉じ（実行中のジョブの完了を待つ）、Redis 接続を閉じる。
 * timeoutMs を超えた場合は打ち切り、呼び出し元に伝える。
 */
const closeWorkersWithTimeout = async (
  workers: readonly NoopWorker[],
  connection: Redis,
  timeoutMs: number,
  generation: GenerationWiring,
): Promise<'closed' | 'timeout'> => {
  const closeAll = (async (): Promise<void> => {
    await Promise.all(workers.map((worker) => worker.close()))
    await generation.close()
    await connection.quit()
  })()

  const timeout = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), timeoutMs)
  })

  return Promise.race([closeAll.then((): 'closed' => 'closed'), timeout])
}

/**
 * SIGINT / SIGTERM で graceful shutdown する。
 * 実行中のジョブの完了を待ち、Worker と Redis 接続を閉じてから exit する。
 * SHUTDOWN_TIMEOUT_MS を超えたら強制終了し、その旨をログに出す。
 */
const registerShutdownHandlers = (
  workers: readonly NoopWorker[],
  connection: Redis,
  logger: Logger,
  generation: GenerationWiring,
): void => {
  let shuttingDown = false

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true

    logger.info({ signal }, 'シャットダウンを開始します。実行中のジョブの完了を待ちます')

    closeWorkersWithTimeout(workers, connection, SHUTDOWN_TIMEOUT_MS, generation)
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
 * worker の起動処理。モジュールのトップレベルでは副作用を実行せず、
 * すべてこの関数にまとめて明示的に呼び出す。
 * ここまでの処理はすべて同期的なため async にはしない。
 */
export const main = (): void => {
  const config = getConfig()
  const logger = createLogger(config.logLevel)

  logger.info({ queues: QUEUE_CONFIGS.map((c) => c.name) }, 'worker を起動します')

  const connection = createRedisConnection(config.redis.url)
  const queueConfigs = resolveQueueConfigs(process.env)

  const stubOutputDir = process.env.STUB_OUTPUT_DIR ?? '/tmp/ixa-stub-output'
  const generation = createGenerationWiring(config, connection, logger, stubOutputDir)

  const workers = createWorkers(queueConfigs, connection, logger, generation)

  registerShutdownHandlers(workers, connection, logger, generation)

  logger.info(
    { concurrency: Object.fromEntries(queueConfigs.map((c) => [c.name, c.concurrency])) },
    'worker の起動が完了しました',
  )
}

try {
  main()
} catch (error) {
  process.exitCode = 1
  process.stderr.write(`worker の起動に失敗しました: ${String(error)}\n`)
}
