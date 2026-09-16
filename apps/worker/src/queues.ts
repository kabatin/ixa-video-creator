import { z } from 'zod'

/**
 * BullMQ で使うキュー名（docs/ARCHITECTURE.md §20）。
 */
export const QUEUE_NAMES = {
  media: 'media',
  generation: 'generation',
  review: 'review',
  render: 'render',
  analysis: 'analysis',
  regeneration: 'regeneration',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

export type QueueConfig = {
  readonly name: QueueName
  readonly concurrency: number
}

/**
 * 既定の並列度（docs/ARCHITECTURE.md §20 の表）。
 * generation は Provider のレート制限（例: BytePlus の QPS 2 / 同時タスク 3 という報告値、
 * §9・R12）に合わせて運用時に調整できる必要があるため、環境変数で上書きできるようにする
 * （resolveQueueConcurrency / resolveQueueConfigs を参照）。ここではハードコードした既定値のみ持つ。
 */
export const QUEUE_CONFIGS: readonly QueueConfig[] = [
  { name: QUEUE_NAMES.media, concurrency: 8 },
  { name: QUEUE_NAMES.generation, concurrency: 2 },
  { name: QUEUE_NAMES.review, concurrency: 4 },
  { name: QUEUE_NAMES.render, concurrency: 1 },
  { name: QUEUE_NAMES.analysis, concurrency: 2 },
  /**
   * 再生成の判定だけを行う軽い処理。生成そのものは generation キューが行う。
   * **review と分けている。** レビューは LLM を叩いて金を払うため、
   * 再生成の投入に失敗しただけでレビューをやり直させたくない。
   */
  { name: QUEUE_NAMES.regeneration, concurrency: 4 },
]

const concurrencyEnvVarName = (queueName: QueueName): string =>
  `WORKER_CONCURRENCY_${queueName.toUpperCase()}`

const positiveIntegerSchema = z.coerce.number().int().positive()

/**
 * 1 キュー分の並列度を解決する純粋関数。
 * `WORKER_CONCURRENCY_<QUEUE大文字>` が未設定、数値でない、または 0 以下の場合は
 * config.concurrency（既定値）にフォールバックする。
 */
export const resolveQueueConcurrency = (config: QueueConfig, env: NodeJS.ProcessEnv): number => {
  const rawValue = env[concurrencyEnvVarName(config.name)]

  if (rawValue === undefined) {
    return config.concurrency
  }

  const parsed = positiveIntegerSchema.safeParse(rawValue)

  return parsed.success ? parsed.data : config.concurrency
}

/**
 * QUEUE_CONFIGS の各要素に環境変数の上書きを適用した、新しい配列を返す。
 * QUEUE_CONFIGS 自体はミューテーションしない。
 */
export const resolveQueueConfigs = (env: NodeJS.ProcessEnv): readonly QueueConfig[] =>
  QUEUE_CONFIGS.map((config) => ({
    ...config,
    concurrency: resolveQueueConcurrency(config, env),
  }))
