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
import { processMediaJob } from './media/index.js'
import { processRenderJob } from './render/index.js'
import { processAnalysisJob } from './analysis/index.js'
import { processReviewJob } from './review/index.js'
import { processRegenerationJob } from './regeneration/index.js'

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
    /**
     * キューごとに担当プロセッサを割り当てる。
     * 未実装のキューは noop のまま。
     * 未実装のキューを無言で成功させないよう、対応表を 1 箇所に集約する。
     */
    const handler = async (job: { data: unknown }): Promise<NoopJobResult> => {
      const state = await (async (): Promise<string> => {
        switch (config.name) {
          case QUEUE_NAMES.generation:
            return (await processGenerationJob(generation.deps, job.data)).state
          case QUEUE_NAMES.media:
            return (await processMediaJob(generation.media, job.data)).state
          case QUEUE_NAMES.render:
            return (await processRenderJob(generation.render, job.data)).state
          case QUEUE_NAMES.analysis:
            return (await processAnalysisJob(generation.analysis, job.data)).state
          case QUEUE_NAMES.review:
            return (await processReviewJob(generation.review, job.data)).state
          case QUEUE_NAMES.regeneration:
            return (await processRegenerationJob(generation.regeneration, job.data)).state
          default:
            return (await processNoopJob(job.data as NoopJobData)).echoed
        }
      })()
      return { echoed: state, processedAt: new Date().toISOString() }
    }

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
