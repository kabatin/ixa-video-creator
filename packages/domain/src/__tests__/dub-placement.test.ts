import { describe, expect, it } from 'vitest'
import { chunkTempo, cutPlan, fitTempo, planLipPair } from '../dub/chunk-tempo.js'

/** 倍率と置き方（ADR-0062）。倍率は 0.8〜1.6、1.4 を超えたら警告、1.6 を超えたら止める。 */

const c = (startSec: number, endSec: number) => ({ startSec, endSec })

describe('chunkTempo', () => {
  it('1.4 倍までは警告なし', () => {
    expect(chunkTempo(1.4)).toEqual({ ok: true, tempo: 1.4, rawTempo: 1.4, warnings: [] })
  })

  it('1.4 倍を超えると早口の警告', () => {
    const result = chunkTempo(1.5)
    expect(result.ok && result.warnings.map((w) => w.code)).toEqual(['fast_tempo'])
    expect(result.ok && result.warnings[0]?.message).toBe('早口に聞こえます。読み方の指示か Shot の指示を直してください')
  })

  it('1.6 倍を超えると止めて理由を出す', () => {
    const result = chunkTempo(1.61)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain('1.6 倍')
    expect(chunkTempo(1.6).ok).toBe(true)
  })

  it('0.8 倍より遅くはしない（声が口より短く終わる）', () => {
    const result = chunkTempo(0.5)
    expect(result.ok && result.tempo).toBe(0.8)
    expect(result.ok && result.warnings.map((w) => w.code)).toEqual(['slow_tempo_clamped'])
  })
})

describe('planLipPair', () => {
  it('組の中の間を詰め（語頭 0.04・語尾 0.06 残す）、倍率は中身の長さ ÷ 元の区間', () => {
    // 読み上げ 0.2〜0.6 と 0.9〜1.3（中身 0.8 秒）。残す分を足して 0.16〜0.66 + 0.86〜1.36 = 1.0 秒。
    const plan = planLipPair({ tts: [c(0.2, 0.6), c(0.9, 1.3)], source: c(2, 2.8) }, { ttsDurationSec: 2, nextSourceStartSec: null, shotDurationSec: 10 })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.pieces).toEqual([c(0.16, 0.66), c(0.86, 1.36)])
    expect(plan.tempo).toBeCloseTo((1.0 - 0.1) / 0.8, 6)
    expect(plan.placedStartSec).toBeCloseTo(1.96, 6)
    expect(plan.placedEndSec).toBeCloseTo(1.96 + 1.0 / plan.tempo, 6)
    expect(plan.warnings).toEqual([])
  })

  it('残す分が重なる短い間は 1 つにつなぐ', () => {
    const plan = planLipPair({ tts: [c(0.2, 0.6), c(0.65, 1.0)], source: c(1, 1.8) }, { ttsDurationSec: 2, nextSourceStartSec: null, shotDurationSec: 10 })
    expect(plan.ok && plan.pieces).toEqual([c(0.16, 1.06)])
  })

  it('次の区間に 0.03 秒を残して切る', () => {
    const plan = planLipPair({ tts: [c(0.1, 0.9)], source: c(1, 1.6) }, { ttsDurationSec: 1, nextSourceStartSec: 1.65, shotDurationSec: 10 })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.placedEndSec).toBeCloseTo(1.62, 6)
    expect(plan.warnings.map((w) => w.code)).toContain('cut_by_next')
  })

  it('最後の組は Shot の尺で切る', () => {
    const plan = planLipPair({ tts: [c(0.1, 0.9)], source: c(1, 1.6) }, { ttsDurationSec: 1, nextSourceStartSec: null, shotDurationSec: 1.6 })
    expect(plan.ok && plan.placedEndSec).toBe(1.6)
    expect(plan.ok && plan.warnings.map((w) => w.code)).toContain('cut_by_next')
  })

  it('頭は 0 秒より前に出ない', () => {
    const plan = planLipPair({ tts: [c(0.1, 0.5)], source: c(0.02, 0.42) }, { ttsDurationSec: 1, nextSourceStartSec: null, shotDurationSec: 10 })
    expect(plan.ok && plan.placedStartSec).toBe(0)
  })

  it('1.6 倍を超える組は止める', () => {
    const plan = planLipPair({ tts: [c(0, 2)], source: c(1, 1.5) }, { ttsDurationSec: 2, nextSourceStartSec: null, shotDurationSec: 10 })
    expect(plan.ok).toBe(false)
  })
})

describe('fitTempo', () => {
  it('収める長さより短ければそのまま', () => {
    expect(fitTempo(1.5, 2)).toEqual({ ok: true, tempo: 1, rawTempo: 1, warnings: [] })
  })

  it('長ければ 長さ ÷ 収める長さ で縮める', () => {
    expect(fitTempo(2.4, 2)).toMatchObject({ ok: true, tempo: 1.2 })
  })

  it('1.6 倍を超えたら止める', () => {
    expect(fitTempo(3.3, 2).ok).toBe(false)
  })
})

describe('cutPlan', () => {
  it('縮めずに切り、最後 0.15 秒でフェード', () => {
    expect(cutPlan(2.5, 1.2)).toEqual({ durationSec: 1.2, fadeOutSec: 0.15 })
  })

  it('切る長さより短ければそのまま（フェードもしない）', () => {
    expect(cutPlan(1, 1.2)).toEqual({ durationSec: 1, fadeOutSec: 0 })
  })

  it('切る長さが 0.15 秒より短ければ、フェードは切る長さまで', () => {
    expect(cutPlan(1, 0.1)).toEqual({ durationSec: 0.1, fadeOutSec: 0.1 })
  })
})
