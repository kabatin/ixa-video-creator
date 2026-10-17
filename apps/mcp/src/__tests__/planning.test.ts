import { describe, expect, it } from 'vitest'
import { energyPeaks, summarizeAnalysis } from '../lib/music-summary.js'
import { boundariesFrom, boundaryProblem, plannedShots, snapBoundaries, snapTo } from '../lib/shot-planning.js'
import type { WireAnalysis } from '../wire.js'

/** vpipe の MiniMax H3（17n+5 コマ / 24fps、n = 3..14）。 */
const VPIPE = { mode: 'enum' as const, values: Array.from({ length: 12 }, (_, i) => (17 * (i + 3) + 5) / 24) }

describe('boundariesFrom', () => {
  it('尺の列を startSec から積み上げ、浮動小数の誤差を丸める', () => {
    expect(boundariesFrom({ kind: 'durations', startSec: 1, durationsSec: [0.1, 0.2, 2.5] })).toEqual([1, 1.1, 1.3, 3.8])
  })
  it('カット点はそのまま（丸めだけ）', () => {
    expect(boundariesFrom({ kind: 'cuts', boundariesSec: [0, 2.0000001, 4] })).toEqual([0, 2, 4])
  })
})

describe('boundaryProblem', () => {
  it('2 つ未満・昇順でないものを断る', () => {
    expect(boundaryProblem([0])).toContain('2 つ以上')
    expect(boundaryProblem([0, 3, 3])).toContain('昇順')
    expect(boundaryProblem([0, 3, 2])).toContain('昇順')
    expect(boundaryProblem([0, 3])).toBeNull()
  })
})

describe('snap', () => {
  const downbeats = [0, 2, 4, 6, 8]
  it('近い格子点へ寄せ、maxShiftSec より遠ければ動かさない', () => {
    expect(snapTo(2.4, downbeats, 1)).toBe(2)
    expect(snapTo(2.4, downbeats, 0.3)).toBe(2.4)
  })
  it('寄せて重なった境界は落とし、昇順を保つ', () => {
    const result = snapBoundaries([0, 1.9, 2.2, 5.1], downbeats, 1)
    expect(result.boundariesSec).toEqual([0, 2, 6])
    expect(result.dropped).toEqual([2.2])
  })
})

describe('plannedShots', () => {
  it('モデルが無ければ開始と尺だけ', () => {
    expect(plannedShots([0, 3], null)).toEqual([{ startSec: 0, durationSec: 3 }])
  })
  it('vpipe の尺へ切り上げ、最長を超えれば遅く再生、1.5 倍を超えれば作れないと言う', () => {
    const plan = plannedShots([0, 2, 12, 30], VPIPE)
    expect(plan[0]).toMatchObject({ durationSec: 2, generateSec: 2.333 })
    expect(plan[1]).toMatchObject({ durationSec: 10, generateSec: 10.125 })
    const stretched = plannedShots([0, 12], VPIPE)[0]
    expect(stretched).toMatchObject({ generateSec: 10.125, note: 'slowed to fit (timing=fit)' })
    expect(plan[2]).toMatchObject({ durationSec: 18, generateSec: null })
    expect(plan[2]?.note).toContain('Shot を分けてください')
  })
})

describe('plannedShots の速さ（ADR-0050）', () => {
  it('頼む長さは尺 × 速さを切り上げたもの。短いカットも作れる', () => {
    expect(plannedShots([0, 1.2], VPIPE, 1.5)[0]).toMatchObject({ durationSec: 1.2, generateSec: 2.333 })
    expect(plannedShots([0, 2], VPIPE, 2)[0]).toMatchObject({ durationSec: 2, generateSec: 4.458 })
  })
  it('尺 × 速さが最長を超えたら、最長で作って速さが落ちると言う（fit とは言わない）', () => {
    const shot = plannedShots([0, 6], VPIPE, 2)[0]
    expect(shot).toMatchObject({ generateSec: 10.125 })
    expect(shot?.note).toContain('speed capped at 1.69x')
  })
})

const analysis = (overrides: Partial<WireAnalysis> = {}): WireAnalysis => ({
  durationSec: 120.123,
  bpm: 128.04,
  bpmConfidence: 0.9,
  beats: Array.from({ length: 256 }, (_, i) => i * 0.46875),
  downbeats: Array.from({ length: 64 }, (_, i) => 0.1 + i * 1.875),
  sections: [{ start: 0, end: 30.004, label: 'intro', energy: 0.3 }],
  energyCurve: { hopSec: 0.5, values: [0, 1, 0, 0.5, 0, 0.9, 0.2, 0, 0, 0, 0, 0, 0, 0.7, 0] },
  drops: [60.555],
  ...overrides,
})

describe('summarizeAnalysis', () => {
  it('数千の数を渡さず、拍の要約とフレーズ頭（4 小節ごと）に畳む', () => {
    const summary = summarizeAnalysis(analysis(), { includeDownbeats: false })
    expect(summary).toMatchObject({ durationSec: 120.12, bpm: 128, barSec: 1.875, downbeatCount: 64, drops: [60.56] })
    expect(summary.phraseStartsSec).toHaveLength(16)
    expect(summary.phraseStartsSec.slice(0, 2)).toEqual([0.1, 7.6])
    expect(summary.downbeatsSec).toBeUndefined()
    expect(summary.sections[0]).toEqual({ label: 'intro', startSec: 0, endSec: 30, energy: 0.3 })
  })
  it('includeDownbeats で小節頭を全部付ける', () => {
    expect(summarizeAnalysis(analysis(), { includeDownbeats: true }).downbeatsSec).toHaveLength(64)
  })
  it('小節頭が 1 つ以下なら小節の長さは null', () => {
    expect(summarizeAnalysis(analysis({ downbeats: [1] }), { includeDownbeats: false }).barSec).toBeNull()
  })
})

describe('energyPeaks', () => {
  it('強い順に選び、近すぎる山は強い方だけ残し、時刻順で返す', () => {
    const peaks = energyPeaks(analysis().energyCurve, 2, 2)
    // 0.5s(1.0) と 2.5s(0.9) は 2 秒差なので両方残る。1.5s(0.5) は 0.5s から 1 秒で落ちる。
    expect(peaks).toEqual([
      { atSec: 0.5, energy: 1 },
      { atSec: 2.5, energy: 0.9 },
    ])
    expect(energyPeaks(analysis().energyCurve, 5, 3).map((p) => p.atSec)).toEqual([0.5, 6.5])
  })
})
