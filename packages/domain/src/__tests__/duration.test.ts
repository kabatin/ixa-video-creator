import { describe, expect, it } from 'vitest'
import {
  DurationNotSupportedError, MAX_GENERATION_STRETCH, canProduceDuration, defaultSourceInSec,
  quantizeDuration, stretchesToFit,
} from '../generation/duration.js'

const VEO = { mode: 'enum', values: [4, 6, 8] } as const
const KLING = { mode: 'enum', values: [5, 10] } as const
const SEEDANCE = { mode: 'range', min: 4, max: 15 } as const
/** vpipe の MiniMax H3（17n+5 コマ / 24fps。n = 3..14）。 */
const H3 = {
  mode: 'enum',
  values: Array.from({ length: 12 }, (_, i) => (17 * (i + 3) + 5) / 24),
} as const

describe('quantizeDuration', () => {
  it('列挙モデルでは要求尺以上で最小の値へ切り上げる', () => {
    expect(quantizeDuration(3.75, VEO)).toBe(4)
    expect(quantizeDuration(4, VEO)).toBe(4)
    expect(quantizeDuration(4.01, VEO)).toBe(6)
    expect(quantizeDuration(3.75, KLING)).toBe(5)
    expect(quantizeDuration(5.5, KLING)).toBe(10)
  })

  it('範囲モデルでは下限未満を下限へ引き上げる', () => {
    expect(quantizeDuration(2, SEEDANCE)).toBe(4)
    expect(quantizeDuration(7.3, SEEDANCE)).toBe(7.3)
  })

  it('step 付きの範囲では step 単位へ切り上げる', () => {
    const stepped = { mode: 'range', min: 2, max: 10, step: 2 } as const
    expect(quantizeDuration(2, stepped)).toBe(2)
    expect(quantizeDuration(2.1, stepped)).toBe(4)
    expect(quantizeDuration(6, stepped)).toBe(6)
  })

  /**
   * 制作者 2026-10-01「ミリ秒まで一致しないと生成できないのは不便すぎる」。
   * 最長より長い Shot は最長で作り、「Take を尺に合わせる」でゆっくり再生して埋める（0.5 倍まで）。
   */
  it('最長を少し超える尺は最長で作る（MiniMax H3 の 10.125 秒に CUT-01 の 10.13 秒）', () => {
    expect(quantizeDuration(10.125, H3)).toBe(10.125)
    expect(quantizeDuration(10.13, H3)).toBe(10.125)
    expect(quantizeDuration(9, VEO)).toBe(8)
    expect(quantizeDuration(16, SEEDANCE)).toBe(15)
  })

  /** 制作者 2026-10-02「Shot 分け判定は 2 倍ではなく 1.5 倍にしましょう」。再生の「尺に合わせる」の幅（0.5 倍まで）とは別。 */
  it('最長で作って伸ばすのは 1.5 倍の長さまで', () => {
    expect(MAX_GENERATION_STRETCH).toBe(1.5)
    expect(quantizeDuration(12, VEO)).toBe(8)
    expect(quantizeDuration(15.1875, H3)).toBe(10.125)
    expect(quantizeDuration(22.5, SEEDANCE)).toBe(15)
    expect(() => quantizeDuration(12.01, VEO)).toThrow(DurationNotSupportedError)
    expect(() => quantizeDuration(15.19, H3)).toThrow(DurationNotSupportedError)
    expect(() => quantizeDuration(22.51, SEEDANCE)).toThrow(DurationNotSupportedError)
  })

  it('step の切り上げが最長を超えるときは、出せる最長で作る', () => {
    const stepped = { mode: 'range', min: 1, max: 10, step: 2 } as const
    expect(quantizeDuration(9.5, stepped)).toBe(9)
    expect(quantizeDuration(12, stepped)).toBe(9)
  })

  it('断るときは人の言葉で言う（尺の一覧を JSON で出さない）', () => {
    const error = (() => {
      try {
        quantizeDuration(21, H3)
      } catch (caught) {
        return caught
      }
      return null
    })()
    expect(error).toBeInstanceOf(DurationNotSupportedError)
    const message = (error as DurationNotSupportedError).message
    expect(message).not.toMatch(/[{}[\]]/)
    expect(message).toContain('10.125')
    expect(message).toContain('21')
    expect(message).toContain('1.5 倍')
    expect(message).toContain('分けて')
  })

  it('canProduceDuration は例外を投げずに可否を返す', () => {
    expect(canProduceDuration(3.75, VEO)).toBe(true)
    expect(canProduceDuration(9, VEO)).toBe(true)
    expect(canProduceDuration(12.01, VEO)).toBe(false)
  })
})

describe('stretchesToFit', () => {
  it('生成尺が編集尺より短いときだけ、ゆっくり再生して埋める', () => {
    expect(stretchesToFit(10.13, 10.125)).toBe(true)
    expect(stretchesToFit(10.125, 10.125)).toBe(false)
    expect(stretchesToFit(3.75, 4)).toBe(false)
  })
})

describe('defaultSourceInSec', () => {
  it('start_frame があるときは先頭から使う', () => {
    expect(defaultSourceInSec(4, 3.75, true)).toBe(0)
  })

  it('余りが小さいときは半分だけ頭を捨てる', () => {
    expect(defaultSourceInSec(4, 3.8, false)).toBeCloseTo(0.1)
  })

  it('余りが大きくても頭を捨てるのは上限まで', () => {
    expect(defaultSourceInSec(10, 3.75, false)).toBe(0.15)
  })

  it('余りが無ければ 0', () => {
    expect(defaultSourceInSec(4, 4, false)).toBe(0)
  })
})
