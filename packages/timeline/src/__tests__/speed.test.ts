import { describe, expect, it } from 'vitest'
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
