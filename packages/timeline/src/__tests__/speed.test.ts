import { describe, expect, it } from 'vitest'
import { requestedSourceSec } from '@ixa/domain'
import { MAX_PLAYBACK_RATE, MIN_PLAYBACK_RATE, shotPlaybackRate, takeShortfallSec } from '../speed.js'

/**
 * 尺に合わせた速度（ADR-0026）。元の MV（手作業の Remotion）と同じ 0.5〜2.5 倍に収める。
 * 39 本中 27 本は動画が枠より短く、速度を落として埋めていた。
 */
const shot = (timing: 'trim' | 'fit', durationSec = 5, sourceInSec = 0) => ({ timing, durationSec, sourceInSec })

describe('shotPlaybackRate', () => {
  it('trim では速度を変えない', () => {
    expect(shotPlaybackRate(shot('trim'), 4)).toBe(1)
  })

  it('fit で短い Take はゆっくりにして尺を埋める', () => {
    expect(shotPlaybackRate(shot('fit', 5), 4)).toBeCloseTo(0.8, 9)
  })

  it('fit で長い Take は速くして全体を収める', () => {
    expect(shotPlaybackRate(shot('fit', 4), 6)).toBeCloseTo(1.5, 9)
  })

  it('切り出し位置（sourceInSec）より後ろだけを収める', () => {
    expect(shotPlaybackRate(shot('fit', 4, 2), 6)).toBeCloseTo(1, 9)
  })

  it('0.5〜2.5 倍に収める', () => {
    expect(shotPlaybackRate(shot('fit', 10), 1)).toBe(MIN_PLAYBACK_RATE)
    expect(shotPlaybackRate(shot('fit', 1), 10)).toBe(MAX_PLAYBACK_RATE)
  })

  it('Take の長さが分からなければ変えない', () => {
    expect(shotPlaybackRate(shot('fit'), null)).toBe(1)
    expect(shotPlaybackRate(shot('fit', 5, 3), 2)).toBe(1)
  })
})

describe('takeShortfallSec', () => {
  it('速度を変えても足りない秒数（最後のコマで止まる長さ）', () => {
    expect(takeShortfallSec(shot('trim', 5), 4)).toBeCloseTo(1, 9)
    expect(takeShortfallSec(shot('fit', 5), 4)).toBe(0)
    // 0.5 倍でも 1 秒しか伸びない → 2 秒のうち 3 秒足りない
    expect(takeShortfallSec(shot('fit', 5), 1)).toBeCloseTo(3, 9)
  })

  it('足りていれば 0、長さが分からなければ 0（黙って警告を作らない）', () => {
    expect(takeShortfallSec(shot('trim', 4), 6)).toBe(0)
    expect(takeShortfallSec(shot('trim', 4), null)).toBe(0)
  })
})

/** 速さ（ADR-0050）。予告編の速い編集。`trim` の Shot だけが使う。 */
describe('速さ', () => {
  const fast = (speed: number, durationSec = 2, sourceInSec = 0) => ({ timing: 'trim' as const, durationSec, sourceInSec, speed })

  it('Take が足りていれば選んだ速さで流す', () => {
    expect(shotPlaybackRate(fast(1.5), 4)).toBeCloseTo(1.5, 9)
  })

  it('速めて Take が足りなければ、足りるところまで落とす（絵を止めない）', () => {
    // 2 秒の尺に 2.5 秒の Take: 2 倍では足りないので 1.25 倍。
    expect(shotPlaybackRate(fast(2), 2.5)).toBeCloseTo(1.25, 9)
    expect(takeShortfallSec(fast(2), 2.5)).toBeCloseTo(0, 9)
  })

  it('1 倍より下げない（それでも足りなければ今までどおり最後のコマで止まる）', () => {
    expect(shotPlaybackRate(fast(2), 1.5)).toBe(1)
    expect(takeShortfallSec(fast(2), 1.5)).toBeCloseTo(0.5, 9)
  })

  it('ゆっくり（1 倍未満）はそのまま', () => {
    expect(shotPlaybackRate(fast(0.5), 4)).toBe(0.5)
  })

  it('Take の長さが分からなければ選んだ速さ', () => {
    expect(shotPlaybackRate(fast(1.5), null)).toBe(1.5)
  })

  it('fit は速さを見ない', () => {
    expect(shotPlaybackRate({ ...fast(2, 4), timing: 'fit' }, 6)).toBeCloseTo(1.5, 9)
  })
})

describe('requestedSourceSec（AI に頼む長さの元）', () => {
  it('trim は尺 × 速さ、fit は尺のまま、速さ 1 は尺のまま', () => {
    expect(requestedSourceSec({ timing: 'trim', durationSec: 1.2, sourceInSec: 0, speed: 1.5 })).toBeCloseTo(1.8, 9)
    // fit も尺 × 速さを頼む（替えても速さが消えない。2026-10-24）。
    expect(requestedSourceSec({ timing: 'fit', durationSec: 1.2, sourceInSec: 0, speed: 1.5 })).toBeCloseTo(1.8, 9)
    expect(requestedSourceSec({ timing: 'trim', durationSec: 1.2, sourceInSec: 0 })).toBe(1.2)
  })
})
