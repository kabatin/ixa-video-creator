import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BEATS_PER_BAR,
  barDurationSec,
  beatsBetween,
  nearestDownbeat,
  quantizeToBarCount,
  snapShotTiming,
} from '../beat-math.js'

/** 120 BPM のビートグリッド。拍間隔 0.5 秒、小節 2.0 秒。 */
const BEATS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]
const DOWNBEATS = [0, 2, 4]

describe('nearestDownbeat', () => {
  it('最も近い小節頭へ寄せる', () => {
    expect(nearestDownbeat(2.3, DOWNBEATS)).toBe(2)
    expect(nearestDownbeat(3.4, DOWNBEATS)).toBe(4)
  })

  it('ちょうど小節頭ならその値を返す', () => {
    expect(nearestDownbeat(2, DOWNBEATS)).toBe(2)
  })

  it('等距離なら早い方を返す', () => {
    expect(nearestDownbeat(1, DOWNBEATS)).toBe(0)
  })

  it('範囲外の時刻は両端へ寄る', () => {
    expect(nearestDownbeat(-10, DOWNBEATS)).toBe(0)
    expect(nearestDownbeat(999, DOWNBEATS)).toBe(4)
  })

  it('ダウンビートが空なら入力をそのまま返す', () => {
    expect(nearestDownbeat(1.23, [])).toBe(1.23)
  })

  it('ダウンビートが 1 つならそれを返す', () => {
    expect(nearestDownbeat(99, [7])).toBe(7)
  })
})

describe('beatsBetween', () => {
  it('end は排他で数える', () => {
    expect(beatsBetween(0, 2, BEATS)).toBe(4)
  })

  it('start はちょうど一致したものを含む', () => {
    expect(beatsBetween(0.5, 1.5, BEATS)).toBe(2)
  })

  it('ビートを 1 つも含まない範囲は 0', () => {
    expect(beatsBetween(0.6, 0.9, BEATS)).toBe(0)
  })

  it('範囲が逆転していたら 0', () => {
    expect(beatsBetween(3, 1, BEATS)).toBe(0)
  })

  it('幅 0 の範囲は 0', () => {
    expect(beatsBetween(1, 1, BEATS)).toBe(0)
  })

  it('ビートが空なら 0', () => {
    expect(beatsBetween(0, 100, [])).toBe(0)
  })

  it('グリッド全体を覆う範囲はすべて数える', () => {
    expect(beatsBetween(-1, 100, BEATS)).toBe(BEATS.length)
  })
})

describe('barDurationSec', () => {
  it('120 BPM の 4/4 は 2 秒', () => {
    expect(barDurationSec(120)).toBe(2)
  })

  it('既定の拍子は 4/4', () => {
    expect(barDurationSec(120, DEFAULT_BEATS_PER_BAR)).toBe(barDurationSec(120))
  })

  it('3 拍子を指定できる', () => {
    expect(barDurationSec(120, 3)).toBe(1.5)
  })

  it('不正な bpm は throw する', () => {
    expect(() => barDurationSec(0)).toThrow(RangeError)
    expect(() => barDurationSec(-1)).toThrow(RangeError)
    expect(() => barDurationSec(Number.NaN)).toThrow(RangeError)
    expect(() => barDurationSec(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('不正な beatsPerBar は throw する', () => {
    expect(() => barDurationSec(120, 0)).toThrow(RangeError)
    expect(() => barDurationSec(120, 1.5)).toThrow(RangeError)
  })
})

describe('quantizeToBarCount', () => {
  it('最も近い小節数へ丸める', () => {
    expect(quantizeToBarCount(4, 120)).toBe(2)
    expect(quantizeToBarCount(4.9, 120)).toBe(2)
    expect(quantizeToBarCount(5.1, 120)).toBe(3)
  })

  it('極小の尺でも 1 小節を下回らない', () => {
    expect(quantizeToBarCount(0.001, 120)).toBe(1)
    expect(quantizeToBarCount(0, 120)).toBe(1)
    expect(quantizeToBarCount(-5, 120)).toBe(1)
  })

  it('拍子を指定できる', () => {
    expect(quantizeToBarCount(4.5, 120, 3)).toBe(3)
  })

  it('不正な入力は throw する', () => {
    expect(() => quantizeToBarCount(Number.NaN, 120)).toThrow(RangeError)
    expect(() => quantizeToBarCount(4, 0)).toThrow(RangeError)
  })
})

describe('snapShotTiming', () => {
  it('開始と終了をそれぞれ拍へ寄せる', () => {
    expect(snapShotTiming(0.6, 0.9, BEATS, 1)).toEqual({ startSec: 0.5, durationSec: 1 })
  })

  it('1/2 拍グリッドでは拍の中間にも寄る', () => {
    // 0.2 → 0.25 へ、終端 0.75 はちょうどグリッド上。尺は 0.5 になる。
    const snapped = snapShotTiming(0.2, 0.55, BEATS, 0.5)
    expect(snapped.startSec).toBeCloseTo(0.25, 10)
    expect(snapped.durationSec).toBeCloseTo(0.5, 10)
  })

  it('1/4 拍グリッドの刻みは 0.125 秒', () => {
    const snapped = snapShotTiming(0.1, 0.1, BEATS, 0.25)
    expect(snapped.startSec).toBeCloseTo(0.125, 10)
    expect(snapped.durationSec).toBeCloseTo(0.125, 10)
  })

  it('極小の尺でも 0 にならず最小 1 グリッド分が残る', () => {
    const snapped = snapShotTiming(1, 0.0001, BEATS, 1)
    expect(snapped.startSec).toBe(1)
    expect(snapped.durationSec).toBeCloseTo(0.5, 10)
  })

  it('尺 0 でも 1 グリッド分が残る', () => {
    expect(snapShotTiming(2, 0, BEATS, 1).durationSec).toBeCloseTo(0.5, 10)
  })

  it('負の尺でも 1 グリッド分が残る', () => {
    const snapped = snapShotTiming(2, -1, BEATS, 1)
    expect(snapped.durationSec).toBeGreaterThan(0)
  })

  it('グリッド末尾から始まっても尺が 0 にならない', () => {
    const snapped = snapShotTiming(4, 0.01, BEATS, 1)
    expect(snapped.startSec).toBe(4)
    expect(snapped.durationSec).toBeGreaterThan(0)
  })

  it('グリッドの範囲外の開始は端の拍へ寄る', () => {
    expect(snapShotTiming(100, 1, BEATS, 1).startSec).toBe(4)
  })

  it('ビートが空なら入力をそのまま返す', () => {
    expect(snapShotTiming(1.3, 2.7, [], 1)).toEqual({ startSec: 1.3, durationSec: 2.7 })
  })

  it('ビートが 1 つだけなら尺が 0 にならない', () => {
    const snapped = snapShotTiming(3, 1, [2], 1)
    expect(snapped.startSec).toBe(2)
    expect(snapped.durationSec).toBeGreaterThanOrEqual(0)
  })

  it('すでにグリッド上にある Shot は変化しない', () => {
    expect(snapShotTiming(1, 2, BEATS, 1)).toEqual({ startSec: 1, durationSec: 2 })
  })
})
