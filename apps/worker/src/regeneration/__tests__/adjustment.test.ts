import {
  ReviewRunId as ReviewRunIdSchema,
  newId,
  type RegenerationPolicy,
  type ReviewFinding,
  type ReviewerType,
  type Severity,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  MAX_REASON_LENGTH,
  decideRegenerationAdjustment,
  type RegenerationDecision,
} from '../adjustment.js'
import { aFinding } from './doubles.js'

const RUN_ID = newId(ReviewRunIdSchema)

/** 既定の policy（DOMAIN.md §12）。自動再生成は identity と technical のみ。 */
const policy: Pick<RegenerationPolicy, 'autoRegenerateOn'> = {
  autoRegenerateOn: ['identity', 'technical'],
}

const finding = (
  reviewer: ReviewerType,
  severity: Severity,
  overrides: Partial<ReviewFinding> = {},
): ReviewFinding => aFinding(RUN_ID, reviewer, severity, overrides)

/** regenerate であることを型で確定させてから中身を見る。 */
const adjustmentOf = (decision: RegenerationDecision) => {
  if (decision.kind !== 'regenerate') {
    throw new Error(`regenerate を期待しましたが ${decision.kind} でした: ${decision.reason}`)
  }
  return decision.adjustment
}

describe('decideRegenerationAdjustment', () => {
  it('identity fail は参照画像の優先度を上げ、seed を変える', () => {
    const adjustment = adjustmentOf(
      decideRegenerationAdjustment(policy, [finding('identity', 'fail')]),
    )

    expect(adjustment.actions.map((a) => a.kind)).toEqual([
      'raise_reference_priority',
      'change_seed',
    ])
    expect(adjustment.changeSeed).toBe(true)
  })

  it('technical fail はパラメータ修正で、seed は変えない', () => {
    const adjustment = adjustmentOf(
      decideRegenerationAdjustment(policy, [finding('technical', 'fail')]),
    )

    expect(adjustment.actions.map((a) => a.kind)).toEqual(['fix_parameters'])
    expect(adjustment.changeSeed).toBe(false)
  })

  it('autoRegenerateOn に無いレビュアの fail は人間に渡す', () => {
    const decision = decideRegenerationAdjustment(policy, [finding('continuity', 'fail')])

    expect(decision.kind).toBe('human')
    if (decision.kind === 'human') expect(decision.reason).toContain('continuity')
  })

  it('自動対象の fail が混ざっていても、対象外の fail が 1 つでもあれば人間に渡す', () => {
    const decision = decideRegenerationAdjustment(policy, [
      finding('identity', 'fail'),
      finding('composition', 'fail'),
    ])

    expect(decision.kind).toBe('human')
  })

  it('autoRegenerateOn を広げればそのレビュアでも自動再生成する', () => {
    const decision = decideRegenerationAdjustment({ autoRegenerateOn: ['composition'] }, [
      finding('composition', 'fail'),
    ])

    expect(adjustmentOf(decision).actions.map((a) => a.kind)).toEqual([
      'strengthen_camera_fragment',
    ])
  })

  it('fail の指摘が無ければ人間に渡す（何を直すか決められない）', () => {
    const decision = decideRegenerationAdjustment(policy, [finding('identity', 'warn')])

    expect(decision.kind).toBe('human')
  })

  it('指摘が空なら人間に渡す', () => {
    expect(decideRegenerationAdjustment(policy, []).kind).toBe('human')
  })

  it('severity の高い指摘から対処する', () => {
    const adjustment = adjustmentOf(
      decideRegenerationAdjustment(policy, [
        finding('identity', 'info'),
        finding('technical', 'fail'),
      ]),
    )

    expect(adjustment.actions[0]?.kind).toBe('fix_parameters')
    expect(adjustment.actions[0]?.severity).toBe('fail')
  })

  it('suggestedPromptDelta を severity 順に集め、重複と空文字を落とす', () => {
    const adjustment = adjustmentOf(
      decideRegenerationAdjustment(policy, [
        finding('identity', 'warn', { suggestedPromptDelta: '  同じ提案  ' }),
        finding('technical', 'fail', { suggestedPromptDelta: '尺を 4 秒にする' }),
        finding('identity', 'fail', { suggestedPromptDelta: '同じ提案' }),
        finding('technical', 'info', { suggestedPromptDelta: '   ' }),
      ]),
    )

    expect(adjustment.promptDeltas).toEqual(['尺を 4 秒にする', '同じ提案'])
  })

  it('自動対象外のレビュアの提案は使わない（warn なので停止もしない）', () => {
    const adjustment = adjustmentOf(
      decideRegenerationAdjustment(policy, [
        finding('identity', 'fail', { suggestedPromptDelta: '参照を強める' }),
        finding('brand', 'warn', { suggestedPromptDelta: 'ロゴを大きく' }),
      ]),
    )

    expect(adjustment.promptDeltas).toEqual(['参照を強める'])
    expect(adjustment.actions.every((a) => a.reviewer === 'identity')).toBe(true)
  })

  it('同じ (調整, レビュア) の組は 1 回しか返さない', () => {
    const adjustment = adjustmentOf(
      decideRegenerationAdjustment(policy, [
        finding('identity', 'fail'),
        finding('identity', 'fail'),
      ]),
    )

    expect(adjustment.actions).toHaveLength(2)
  })

  it('reason は上限の長さで切り詰める', () => {
    const adjustment = adjustmentOf(
      decideRegenerationAdjustment(policy, [
        finding('identity', 'fail', { message: 'あ'.repeat(1000) }),
      ]),
    )

    expect(adjustment.reason.length).toBe(MAX_REASON_LENGTH)
  })

  it('入力の配列をミューテーションしない', () => {
    const findings = [finding('identity', 'info'), finding('technical', 'fail')]
    const before = findings.map((f) => f.id)

    decideRegenerationAdjustment(policy, findings)

    expect(findings.map((f) => f.id)).toEqual(before)
  })
})
