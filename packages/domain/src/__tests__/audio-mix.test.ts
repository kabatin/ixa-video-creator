import { describe, expect, it } from 'vitest'
import {
  DUCKING_DEPTH_DB,
  DuckingSettings,
  dbToGain,
  duckingGainAt,
  fadeGainAt,
  mergeVoiceSpans,
} from '../audio/mix.js'

/**
 * 音の仕上げ（ADR-0039）。ナレーションが鳴る間は BGM を下げる（ダッキング）。曲の頭と終わりはフェードする。
 * プレビューと書き出しで同じ音になるよう、時刻 → 音量の倍率の純関数にしておく（描く側は 1 コマごとに呼ぶ）。
 */

const SETTINGS = DuckingSettings.parse({ enabled: true, depthDb: 10, attackSec: 0.2, releaseSec: 0.4 })

describe('dbToGain', () => {
  it('-10 dB は約 0.316 倍、0 dB は 1 倍', () => {
    expect(dbToGain(-10)).toBeCloseTo(0.3162, 4)
    expect(dbToGain(0)).toBe(1)
  })
})

describe('DuckingSettings', () => {
  it('既定はオン・中（10 dB 下げる）', () => {
    expect(DuckingSettings.parse({})).toEqual({ enabled: true, depthDb: DUCKING_DEPTH_DB.medium, attackSec: 0.15, releaseSec: 0.4 })
  })

  it('下げ幅は 0〜24 dB、立ち上がり・戻りは 0〜2 秒', () => {
    expect(DuckingSettings.safeParse({ depthDb: 25 }).success).toBe(false)
    expect(DuckingSettings.safeParse({ depthDb: -1 }).success).toBe(false)
    expect(DuckingSettings.safeParse({ attackSec: 2.1 }).success).toBe(false)
    expect(DuckingSettings.safeParse({ releaseSec: -0.1 }).success).toBe(false)
  })
})

describe('mergeVoiceSpans', () => {
  it('重なる区間と、下げて戻すより短い隙間はつなぐ（隙間で BGM が上下してうるさくならない）', () => {
    expect(
      mergeVoiceSpans(
        [
          { startSec: 3, endSec: 4 },
          { startSec: 0, endSec: 1 },
          { startSec: 1.5, endSec: 2 },
        ],
        SETTINGS,
      ),
    ).toEqual([
      { startSec: 0, endSec: 2 },
      { startSec: 3, endSec: 4 },
    ])
  })
})

describe('duckingGainAt', () => {
  const spans = mergeVoiceSpans([{ startSec: 2, endSec: 4 }], SETTINGS)
  const low = dbToGain(-10)

  it('声の間は下げた音量、離れていれば 1 倍', () => {
    expect(duckingGainAt(3, spans, SETTINGS)).toBeCloseTo(low)
    expect(duckingGainAt(0, spans, SETTINGS)).toBe(1)
    expect(duckingGainAt(10, spans, SETTINGS)).toBe(1)
  })

  it('声の少し前から下げ始め（最初の音が埋もれない）、声の後でゆっくり戻す', () => {
    expect(duckingGainAt(1.9, spans, SETTINGS)).toBeCloseTo((1 + low) / 2)
    expect(duckingGainAt(4.2, spans, SETTINGS)).toBeCloseTo((1 + low) / 2)
  })

  it('切ってあれば常に 1 倍', () => {
    expect(duckingGainAt(3, spans, { ...SETTINGS, enabled: false })).toBe(1)
  })
})

describe('fadeGainAt', () => {
  const clip = { startSec: 10, durationSec: 4, fadeInSec: 1, fadeOutSec: 2 }

  it('頭は 0 から 1 へ、終わりは 1 から 0 へ直線で変える', () => {
    expect(fadeGainAt(10, clip)).toBe(0)
    expect(fadeGainAt(10.5, clip)).toBeCloseTo(0.5)
    expect(fadeGainAt(11.5, clip)).toBe(1)
    expect(fadeGainAt(13, clip)).toBeCloseTo(0.5)
    expect(fadeGainAt(14, clip)).toBe(0)
  })

  it('フェードが無ければ 1 倍。区間の外は 0 倍', () => {
    expect(fadeGainAt(10, { ...clip, fadeInSec: 0 })).toBe(1)
    expect(fadeGainAt(9, clip)).toBe(0)
  })

  it('短い区間でフェードが重なるときは小さいほう', () => {
    expect(fadeGainAt(11, { startSec: 10, durationSec: 2, fadeInSec: 2, fadeOutSec: 2 })).toBeCloseTo(0.5)
  })
})
