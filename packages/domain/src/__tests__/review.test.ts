import { describe, expect, it } from 'vitest'
import { ProjectId } from '../common/ids.js'
import { aggregateVerdict, canRegenerate, isDeterministicReviewer } from '../review/review.js'

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
