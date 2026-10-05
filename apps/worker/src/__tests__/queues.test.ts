import { describe, expect, it } from 'vitest'
import {
  QUEUE_CONFIGS,
  QUEUE_NAMES,
  resolveQueueConcurrency,
  resolveQueueConfigs,
  type QueueConfig,
} from '../queues.js'

describe('QUEUE_CONFIGS', () => {
  it('8つのキューがすべて定義されている', () => {
    expect(QUEUE_CONFIGS).toHaveLength(8)
    expect(QUEUE_CONFIGS.map((config) => config.name).sort()).toEqual(
      Object.values(QUEUE_NAMES).sort(),
    )
  })

  it('既定の並列度が docs/ARCHITECTURE.md §20 の通り', () => {
    const byName = Object.fromEntries(
      QUEUE_CONFIGS.map((config) => [config.name, config.concurrency]),
    )

    expect(byName).toEqual({
      media: 8,
      generation: 2,
      review: 4,
      render: 1,
      analysis: 2,
      regeneration: 4,
      // 絵コンテの画像（ADR-0029）。Codex CLI は契約の利用枠で動くので、同時に何本も走らせない。
      image: 1,
      // ナレーションの声と文字起こし（ADR-0038）。外部 API の回数の上限に配慮して 1 つずつ。
      voice: 1,
    })
  })
})

describe('resolveQueueConcurrency', () => {
  const generationConfig: QueueConfig = { name: QUEUE_NAMES.generation, concurrency: 2 }

  it('環境変数が未設定なら既定値を返す', () => {
    expect(resolveQueueConcurrency(generationConfig, {})).toBe(2)
  })

  it('環境変数が有効な正の整数ならそれを使う', () => {
    expect(resolveQueueConcurrency(generationConfig, { WORKER_CONCURRENCY_GENERATION: '3' })).toBe(
      3,
    )
  })

  it('数値でない場合は既定値にフォールバックする', () => {
    expect(
      resolveQueueConcurrency(generationConfig, { WORKER_CONCURRENCY_GENERATION: 'abc' }),
    ).toBe(2)
  })

  it('0の場合は既定値にフォールバックする', () => {
    expect(resolveQueueConcurrency(generationConfig, { WORKER_CONCURRENCY_GENERATION: '0' })).toBe(
      2,
    )
  })

  it('負の値の場合は既定値にフォールバックする', () => {
    expect(resolveQueueConcurrency(generationConfig, { WORKER_CONCURRENCY_GENERATION: '-1' })).toBe(
      2,
    )
  })

  it('小数の場合は既定値にフォールバックする', () => {
    expect(
      resolveQueueConcurrency(generationConfig, { WORKER_CONCURRENCY_GENERATION: '1.5' }),
    ).toBe(2)
  })
})

describe('resolveQueueConfigs', () => {
  it('複数キューの上書きを同時に解決し、指定のないキューは既定値のまま', () => {
    const resolved = resolveQueueConfigs({
      WORKER_CONCURRENCY_GENERATION: '3',
      WORKER_CONCURRENCY_MEDIA: '10',
    })

    const byName = Object.fromEntries(resolved.map((config) => [config.name, config.concurrency]))

    expect(byName).toEqual({
      media: 10,
      generation: 3,
      review: 4,
      render: 1,
      analysis: 2,
      regeneration: 4,
      image: 1,
      voice: 1,
    })
  })

  it('元の QUEUE_CONFIGS をミューテーションしない', () => {
    resolveQueueConfigs({ WORKER_CONCURRENCY_GENERATION: '99' })

    const generationConfig = QUEUE_CONFIGS.find((config) => config.name === QUEUE_NAMES.generation)

    expect(generationConfig?.concurrency).toBe(2)
  })
})
