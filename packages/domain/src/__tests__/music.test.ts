import { describe, expect, it } from 'vitest'
import { expandBeatGrid, snapToBeat } from '../music/music.js'
import { canonicalJson } from '../generation/spec.js'
import { framesToSeconds, rangesOverlap, secondsToFrames } from '../common/time.js'

const beats = [0, 0.5, 1, 1.5, 2]

describe('snapToBeat', () => {
  it('最も近い拍へ寄せる', () => {
    expect(snapToBeat(0.6, beats)).toBe(0.5)
    expect(snapToBeat(0.76, beats)).toBe(1)
  })
  it('8分に分割したグリッドへ寄せられる', () => {
    expect(snapToBeat(0.26, beats, 0.5)).toBeCloseTo(0.25)
  })
  it('拍が無ければ入力をそのまま返す', () => {
    expect(snapToBeat(1.23, [])).toBe(1.23)
  })
})

describe('expandBeatGrid', () => {
  it('16分では拍間を 4 分割する', () => {
    const grid = expandBeatGrid([0, 1], 0.25)
    expect(grid).toEqual([0, 0.25, 0.5, 0.75, 1])
  })
})

describe('canonicalJson', () => {
  it('キー順が違っても同じ文字列になる', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } }))
      .toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
  })
  it('配列の順序は保持する', () => {
    expect(canonicalJson([2, 1])).toBe('[2,1]')
  })
})

describe('time', () => {
  it('秒とフレームを round で往復する', () => {
    expect(secondsToFrames(1.017, 30)).toBe(31)
    expect(framesToSeconds(30, 30)).toBe(1)
  })
  it('境界が一致する範囲は重ならない', () => {
    expect(rangesOverlap({ start: 0, end: 5 }, { start: 5, end: 10 })).toBe(false)
    expect(rangesOverlap({ start: 0, end: 5 }, { start: 4, end: 10 })).toBe(true)
  })
})
