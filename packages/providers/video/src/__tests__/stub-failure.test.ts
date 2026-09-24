import { describe, expect, it } from 'vitest'
import { stubShouldFail } from '../stub/provider.js'

/**
 * わざと失敗させる口（`STUB_VIDEO_FAILURE_RATE`）。
 *
 * **これが無いと、生成が失敗したときの経路は実 Provider を有料で回すまで
 * 一度も走らない。** 初めて走るのが本番、という状態を作らないために置く。
 */

const refs = Array.from({ length: 400 }, (_unused, i) => `job-${String(i)}-0f3a`)

describe('stubShouldFail', () => {
  it('既定（0）では落とさない', () => {
    expect(refs.every((ref) => !stubShouldFail(ref, 0))).toBe(true)
  })

  it('1 なら全部落とす', () => {
    expect(refs.every((ref) => stubShouldFail(ref, 1))).toBe(true)
  })

  /** 同じジョブが試すたびに違う結果になると、失敗の経路を追いかけられない。 */
  it('同じジョブは何度聞いても同じ答え', () => {
    refs.slice(0, 50).forEach((ref) => {
      const first = stubShouldFail(ref, 0.34)
      for (let i = 0; i < 5; i += 1) expect(stubShouldFail(ref, 0.34)).toBe(first)
    })
  })

  /** 3 本頼んで 1 本だけ落ちる形（部分失敗）を試せること。 */
  it('割合におおよそ従う', () => {
    const failed = refs.filter((ref) => stubShouldFail(ref, 0.34)).length
    const ratio = failed / refs.length
    expect(ratio).toBeGreaterThan(0.24)
    expect(ratio).toBeLessThan(0.44)
  })

  it('割合を上げると落ちる数は減らない（単調）', () => {
    const counts = [0, 0.25, 0.5, 0.75, 1].map(
      (rate) => refs.filter((ref) => stubShouldFail(ref, rate)).length,
    )
    counts.forEach((count, i) => {
      if (i > 0) expect(count).toBeGreaterThanOrEqual(counts[i - 1] ?? 0)
    })
  })
})
