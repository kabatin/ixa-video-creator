import { describe, expect, it } from 'vitest'
import { ModelEconomics } from '../capabilities.js'
import { estimateLatencySec } from '../latency.js'

/**
 * 生成にかかる時間の目安（制作者 2026-10-02「5秒ぐらいの動画で7分だからそれから計算する必要がありそう」）。
 * 以前はモデルごとに一律（MiniMax 下書きは 7 分）で、10 秒の Shot（実測 15 分）も「約 7 分」と出ていた。
 */

describe('estimateLatencySec', () => {
  it('尺 1 秒あたりの時間を持つモデルは、作る尺から見積もる', () => {
    const economics = { costPerSecondUsd: 0, typicalLatencySec: 420, latencySecPerOutputSec: 87 }

    expect(estimateLatencySec(economics, 10.125)).toBeCloseTo(880.875)
    expect(estimateLatencySec(economics, 5.167)).toBeCloseTo(449.529)
  })

  it('持たないモデル・尺が分からないときは、モデルの一律の目安', () => {
    expect(estimateLatencySec({ costPerSecondUsd: 0.1, typicalLatencySec: 60 }, 10)).toBe(60)
    expect(
      estimateLatencySec({ costPerSecondUsd: 0, typicalLatencySec: 420, latencySecPerOutputSec: 87 }, null),
    ).toBe(420)
  })
})

describe('ModelEconomics の尺 1 秒あたりの時間', () => {
  it('省略できる', () => {
    expect(ModelEconomics.safeParse({ costPerSecondUsd: 0, typicalLatencySec: 60 }).success).toBe(true)
  })

  it.each([0, -1])('%s は受け付けない（目安が 0 秒や負になる）', (latencySecPerOutputSec) => {
    expect(
      ModelEconomics.safeParse({ costPerSecondUsd: 0, typicalLatencySec: 60, latencySecPerOutputSec }).success,
    ).toBe(false)
  })
})
