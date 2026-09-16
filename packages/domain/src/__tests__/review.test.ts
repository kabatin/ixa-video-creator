import { describe, expect, it } from 'vitest'
import { ProjectId } from '../common/ids.js'
import {
  DEFAULT_PROJECT_BUDGET_USD,
  aggregateVerdict,
  canRegenerate,
  isDeterministicReviewer,
  resolveRegenerationPolicy,
} from '../review/review.js'

const policy = {
  projectId: ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  maxAttemptsPerShot: 3,
  maxCostPerShotUsd: 2,
  maxCostPerProjectUsd: 100,
  requireHumanApprovalAfter: 2,
  autoRegenerateOn: ['identity' as const, 'technical' as const],
}

describe('aggregateVerdict', () => {
  it('fail が 1 つでもあれば fail', () => {
    expect(aggregateVerdict([{ severity: 'info' }, { severity: 'fail' }])).toBe('fail')
  })
  it('warn のみなら warn', () => {
    expect(aggregateVerdict([{ severity: 'info' }, { severity: 'warn' }])).toBe('warn')
  })
  it('指摘なしは pass', () => {
    expect(aggregateVerdict([])).toBe('pass')
  })
})

describe('canRegenerate', () => {
  it('余裕があれば許可する', () => {
    expect(canRegenerate(policy, { attempts: 1, shotCostUsd: 0.5, projectCostUsd: 10 }))
      .toEqual({ allowed: true })
  })

  it('試行回数の上限で止める', () => {
    const gate = canRegenerate(policy, { attempts: 3, shotCostUsd: 0, projectCostUsd: 0 })
    expect(gate.allowed).toBe(false)
    if (!gate.allowed) expect(gate.needsHuman).toBe(true)
  })

  it('Shot あたりのコスト上限で止める', () => {
    const gate = canRegenerate(policy, { attempts: 0, shotCostUsd: 2, projectCostUsd: 0 })
    expect(gate.allowed).toBe(false)
  })

  it('プロジェクト予算で止める', () => {
    const gate = canRegenerate(policy, { attempts: 0, shotCostUsd: 0, projectCostUsd: 100 })
    expect(gate.allowed).toBe(false)
  })

  it('人間の承認が要る回数に達したら止める', () => {
    const gate = canRegenerate(policy, { attempts: 2, shotCostUsd: 0, projectCostUsd: 0 })
    expect(gate.allowed).toBe(false)
    if (!gate.allowed) expect(gate.needsHuman).toBe(true)
  })
})

describe('isDeterministicReviewer', () => {
  it('決定的レビュアと LLM レビュアを区別する', () => {
    expect(isDeterministicReviewer('technical')).toBe(true)
    expect(isDeterministicReviewer('music')).toBe(true)
    expect(isDeterministicReviewer('identity')).toBe(false)
  })
})

describe('resolveRegenerationPolicy', () => {
  const projectId = ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')

  it('Project の予算をプロジェクト上限に使う', () => {
    const resolved = resolveRegenerationPolicy({ id: projectId, budgetUsd: 50 })

    expect(resolved.maxCostPerProjectUsd).toBe(50)
    expect(resolved.projectId).toBe(projectId)
  })

  it('予算が未設定でも「上限なし」を作らない', () => {
    const resolved = resolveRegenerationPolicy({ id: projectId, budgetUsd: null })

    expect(resolved.maxCostPerProjectUsd).toBe(DEFAULT_PROJECT_BUDGET_USD)
  })

  it('予算 0 も既定値へ倒す（0 だと最初の 1 回も回せない）', () => {
    const resolved = resolveRegenerationPolicy({ id: projectId, budgetUsd: 0 })

    expect(resolved.maxCostPerProjectUsd).toBe(DEFAULT_PROJECT_BUDGET_USD)
  })

  it('回数と人間判断の既定はスキーマの既定値を使う', () => {
    const resolved = resolveRegenerationPolicy({ id: projectId, budgetUsd: 10 })

    expect(resolved.maxAttemptsPerShot).toBe(3)
    expect(resolved.requireHumanApprovalAfter).toBe(2)
    expect(resolved.maxCostPerShotUsd).toBe(2)
    expect(resolved.autoRegenerateOn).toEqual(['identity', 'technical'])
  })

  it('導いたポリシーは、そのまま canRegenerate に渡せる', () => {
    const resolved = resolveRegenerationPolicy({ id: projectId, budgetUsd: 10 })
    const gate = canRegenerate(resolved, { attempts: 0, shotCostUsd: 0, projectCostUsd: 0 })

    expect(gate.allowed).toBe(true)
  })
})
