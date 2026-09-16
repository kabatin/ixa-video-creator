import type { Severity } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import type { VisionReviewer } from '../port.js'
import { createStubVisionReviewer } from '../stub-reviewer.js'
import { makeReviewRequest } from './fixtures.js'

/**
 * スタブを使って**再生成ループ全体**を回す。判定の賢さではなく、
 * 「fail → 差分をプロンプトへ反映 → 再判定」の配線が通ることを確かめるのが目的（ADR-0014）。
 */

type Attempt = {
  readonly criteria: string
  readonly severity: Severity
  readonly score: number
}

type LoopOutcome = {
  readonly attempts: readonly Attempt[]
  readonly converged: boolean
  readonly totalCostUsd: number
}

const BASE_CRITERIA = '主役の顔が参照画像と一致していること'

const runRegenerationLoop = async (
  reviewerFor: (attempt: number) => VisionReviewer,
  maxAttempts: number,
): Promise<LoopOutcome> => {
  const step = async (
    attempt: number,
    criteria: string,
    history: readonly Attempt[],
    costUsd: number,
  ): Promise<LoopOutcome> => {
    if (attempt > maxAttempts) {
      return { attempts: history, converged: false, totalCostUsd: costUsd }
    }

    // Take ごとに新しいフレームを抜く想定で、判定対象のラベルも試行ごとに変える。
    const request = makeReviewRequest({
      criteria,
      subjects: [{ label: `frame@1.5s`, url: `https://example.test/take-${attempt}.png?sig=x` }],
    })
    const outcome = await reviewerFor(attempt).review(request)
    const nextHistory: readonly Attempt[] = [
      ...history,
      { criteria, severity: outcome.result.severity, score: outcome.result.score },
    ]
    const nextCost = costUsd + outcome.costUsd

    if (outcome.result.severity !== 'fail') {
      return { attempts: nextHistory, converged: true, totalCostUsd: nextCost }
    }
    if (outcome.result.suggestedPromptDelta === null) {
      throw new Error('fail を返したのにプロンプト差分が null だった')
    }

    return step(attempt + 1, `${criteria} / ${outcome.result.suggestedPromptDelta}`, nextHistory, nextCost)
  }

  return step(1, BASE_CRITERIA, [], 0)
}

describe('スタブによる再生成ループ', () => {
  it('fail が続けば上限まで再生成し、その都度プロンプトが伸びる', async () => {
    const alwaysFail = createStubVisionReviewer({ outcome: 'fail' })
    const outcome = await runRegenerationLoop(() => alwaysFail, 3)

    expect(outcome.converged).toBe(false)
    expect(outcome.attempts).toHaveLength(3)
    expect(outcome.attempts.every((attempt) => attempt.severity === 'fail')).toBe(true)

    const lengths = outcome.attempts.map((attempt) => attempt.criteria.length)
    expect(lengths[0]).toBeLessThan(lengths[1] ?? 0)
    expect(lengths[1]).toBeLessThan(lengths[2] ?? 0)
    expect(outcome.attempts[0]?.criteria).toBe(BASE_CRITERIA)
    expect(outcome.attempts[2]?.criteria).toContain('参照画像の顔に合わせ')
  })

  it('差分を反映した 2 回目で通れば、そこでループを抜ける', async () => {
    const failing = createStubVisionReviewer({ outcome: 'fail' })
    const passing = createStubVisionReviewer({ outcome: 'info' })
    const outcome = await runRegenerationLoop((attempt) => (attempt === 1 ? failing : passing), 5)

    expect(outcome.converged).toBe(true)
    expect(outcome.attempts).toHaveLength(2)
    expect(outcome.attempts.map((attempt) => attempt.severity)).toEqual(['fail', 'info'])
  })

  it('warn では再生成せず、指摘だけ残して抜ける', async () => {
    const warning = createStubVisionReviewer({ outcome: 'warn' })
    const outcome = await runRegenerationLoop(() => warning, 5)

    expect(outcome.converged).toBe(true)
    expect(outcome.attempts).toHaveLength(1)
  })

  it('ループ全体のコストは 0（課金もレート制限も無しで CI から回せる）', async () => {
    const outcome = await runRegenerationLoop(() => createStubVisionReviewer({ outcome: 'fail' }), 4)
    expect(outcome.totalCostUsd).toBe(0)
  })

  it('ループ全体が決定的で、2 回流しても同じ履歴になる', async () => {
    const build = (attempt: number): VisionReviewer =>
      createStubVisionReviewer({ outcome: attempt === 1 ? 'fail' : 'auto' })

    expect(await runRegenerationLoop(build, 4)).toEqual(await runRegenerationLoop(build, 4))
  })
})
