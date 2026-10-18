import { describe, expect, it } from 'vitest'
import {
  clipSoloRange,
  reachedSoloEnd,
  resolveSoloRange,
  SOLO_END_EPSILON_SEC,
  SOLO_STOP_MARGIN_MS,
  soloStopDelayMs,
} from '@/lib/audio-solo'

describe('clipSoloRange', () => {
  it('クリップは inSec から durationSec だけ（outSec は見ない。レンダラと同じ）', () => {
    expect(clipSoloRange({ inSec: 0.25, durationSec: 0.4 })).toEqual({ inSec: 0.25, outSec: 0.65 })
  })
})

describe('resolveSoloRange', () => {
  it('範囲を渡さなければ全体（楽曲）', () => {
    expect(resolveSoloRange(undefined, 116.5)).toEqual({ inSec: 0, outSec: 116.5 })
  })

  it('効果音はトリムの範囲だけ', () => {
    expect(resolveSoloRange({ inSec: 0.25, outSec: 1.2 }, 3)).toEqual({ inSec: 0.25, outSec: 1.2 })
  })

  it('範囲は音の尺に収める', () => {
    expect(resolveSoloRange({ inSec: -1, outSec: 9 }, 3)).toEqual({ inSec: 0, outSec: 3 })
  })

  it('尺が分からない・鳴らす範囲が無いときは null（押せない）', () => {
    expect(resolveSoloRange(undefined, 0)).toBeNull()
    expect(resolveSoloRange(undefined, Number.NaN)).toBeNull()
    expect(resolveSoloRange({ inSec: 2, outSec: 2 }, 3)).toBeNull()
    expect(resolveSoloRange({ inSec: 4, outSec: 5 }, 3)).toBeNull()
  })
})

describe('reachedSoloEnd', () => {
  const range = { inSec: 0.5, outSec: 1.5 }
  it('終わりの手前までは鳴らし続け、終わりに着いたら止める', () => {
    expect(reachedSoloEnd(1, range)).toBe(false)
    expect(reachedSoloEnd(1.5 - SOLO_END_EPSILON_SEC * 2, range)).toBe(false)
    expect(reachedSoloEnd(1.5 - SOLO_END_EPSILON_SEC, range)).toBe(true)
    expect(reachedSoloEnd(1.6, range)).toBe(true)
  })
})

describe('soloStopDelayMs', () => {
  const range = { inSec: 0.5, outSec: 1.5 }
  it('まだ頭から進んでいなければ予約しない（読み込み中に止めない）', () => {
    expect(soloStopDelayMs(0.5, range)).toBeNull()
    expect(soloStopDelayMs(0.2, range)).toBeNull()
  })

  it('残りの時間から少し早めに予約する（はみ出さない）', () => {
    expect(soloStopDelayMs(1, range)).toBeCloseTo(500 - SOLO_STOP_MARGIN_MS)
    expect(soloStopDelayMs(1.49, range)).toBeCloseTo(10 - SOLO_STOP_MARGIN_MS)
  })

  it('終わりを過ぎていれば今すぐ', () => {
    expect(soloStopDelayMs(1.6, range)).toBe(0)
  })
})
