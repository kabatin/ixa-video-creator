import { describe, expect, it } from 'vitest'
import { ProjectId, ShotId } from '../common/ids.js'
import {
  CostLimits, DEFAULT_COST_LIMITS, checkCostLimits, summarizeCost,
  type CostState,
} from '../generation/cost-guard.js'

const limits = (o: Partial<CostLimits> = {}): CostLimits =>
  CostLimits.parse({
    projectBudgetUsd: 100, maxCostPerShotUsd: 6, maxCostPerRequestUsd: 2, ...o,
  })
const state = (o: Partial<CostState> = {}): CostState => ({
  projectSpentUsd: 0, shotSpentUsd: 0, ...o,
})

describe('checkCostLimits', () => {
  it('余裕があれば許可する', () => {
    const d = checkCostLimits(limits(), state(), 0.5)
    expect(d.allowed).toBe(true)
    expect(d.estimatedUsd).toBe(0.5)
  })

  it('1 回の要求の上限で止める', () => {
    const d = checkCostLimits(limits(), state(), 2.5)
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.limit).toBe('request')
  })

  it('Shot の累積で止める（使用済みを含めて判定する）', () => {
    const d = checkCostLimits(limits(), state({ shotSpentUsd: 5.8 }), 0.5)
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      expect(d.limit).toBe('shot')
      expect(d.reason).toContain('5.800')
    }
  })

  it('プロジェクトの予算で止める', () => {
    const d = checkCostLimits(limits(), state({ projectSpentUsd: 99.9 }), 0.5)
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.limit).toBe('project_budget')
  })

  it('予算が null なら無制限（ただし Shot と要求の上限は効く）', () => {
    const l = limits({ projectBudgetUsd: null })
    expect(checkCostLimits(l, state({ projectSpentUsd: 1_000_000 }), 0.5).allowed).toBe(true)
    expect(checkCostLimits(l, state({ shotSpentUsd: 5.9 }), 0.5).allowed).toBe(false)
  })

  it('上限ちょうどは許可し、1 セントでも超えたら止める', () => {
    expect(checkCostLimits(limits(), state(), 2).allowed).toBe(true)
    expect(checkCostLimits(limits(), state(), 2.01).allowed).toBe(false)
    expect(checkCostLimits(limits(), state({ shotSpentUsd: 5.5 }), 0.5).allowed).toBe(true)
    expect(checkCostLimits(limits(), state({ shotSpentUsd: 5.5 }), 0.51).allowed).toBe(false)
  })

  it('厳しい上限から順に判定する（どれを緩めればよいか分かるように）', () => {
    // 要求・Shot・予算のすべてに抵触する場合、最も手前の要求上限を返す
    const d = checkCostLimits(
      limits({ maxCostPerRequestUsd: 1 }),
      state({ shotSpentUsd: 10, projectSpentUsd: 200 }),
      50,
    )
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.limit).toBe('request')
  })

  it('既定値は実 Provider の単価で 4 Take 分を許す', () => {
    // Seedance 720p 約 $0.303/秒。5 秒 × 4 Take = 約 $6
    expect(DEFAULT_COST_LIMITS.maxCostPerRequestUsd).toBeGreaterThanOrEqual(6)
  })

  it('要求上限が Shot 上限より大きい設定は作れない（効かない設定を防ぐ）', () => {
    expect(() =>
      CostLimits.parse({ projectBudgetUsd: 100, maxCostPerShotUsd: 2, maxCostPerRequestUsd: 5 }),
    ).toThrow()
  })

  it('Shot 上限がプロジェクト予算より大きい設定は作れない', () => {
    expect(() =>
      CostLimits.parse({ projectBudgetUsd: 1, maxCostPerShotUsd: 6, maxCostPerRequestUsd: 6 }),
    ).toThrow()
  })
})

describe('summarizeCost', () => {
  const pid = ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')
  const s1 = ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1')
  const s2 = ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA2')

  it('Shot ごとと全体を集計する', () => {
    const r = summarizeCost(pid, [
      { shotId: s1, costUsd: 0.3 },
      { shotId: s1, costUsd: 0.4 },
      { shotId: s2, costUsd: 1.2 },
    ])
    expect(r.totalUsd).toBeCloseTo(1.9)
    expect(r.byShot.get(s1)).toBeCloseTo(0.7)
    expect(r.byShot.get(s2)).toBeCloseTo(1.2)
  })

  it('Take が無ければ 0', () => {
    expect(summarizeCost(pid, []).totalUsd).toBe(0)
  })
})
