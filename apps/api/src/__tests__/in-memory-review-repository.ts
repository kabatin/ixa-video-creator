import { DbNotFoundError, type ReviewRepository } from '@ixa/db'
import {
  CreateReviewFindingInput as CreateReviewFindingInputSchema,
  CreateReviewRunInput as CreateReviewRunInputSchema,
  ReviewFinding as ReviewFindingSchema,
  ReviewFindingId as ReviewFindingIdSchema,
  ReviewRun as ReviewRunSchema,
  ReviewRunId as ReviewRunIdSchema,
  ReviewRunOutcome as ReviewRunOutcomeSchema,
  newId,
  type ReviewFinding,
  type ReviewRun,
  type ReviewRunId,
} from '@ixa/domain'

/**
 * ReviewRepository のインメモリ実装。実 DB には接続しない。
 * 実装と同じく Domain 型のみを返し、保持する値は毎回作り直す（破壊的変更をしない）。
 *
 * **判定は追記のみ。** 動かせるのは `completeRun` の status / verdict / costUsd だけで、
 * 既存の指摘を書き換える口は本物と同じく持たせない。
 */

/** `createRun` が採番する createdAt。テストで日時を突き合わせられるよう固定する。 */
export const REVIEW_RUN_CREATED_AT = new Date('2026-01-01T00:00:00.000Z')

export type InMemoryReviewRepository = ReviewRepository & {
  readonly snapshotRuns: () => readonly ReviewRun[]
  readonly snapshotFindings: () => readonly ReviewFinding[]
}

export const createInMemoryReviewRepository = (
  seedRuns: readonly ReviewRun[] = [],
  seedFindings: readonly ReviewFinding[] = [],
): InMemoryReviewRepository => {
  let runs: readonly ReviewRun[] = seedRuns.map((run) => ReviewRunSchema.parse(run))
  let findings: readonly ReviewFinding[] = seedFindings.map((finding) =>
    ReviewFindingSchema.parse(finding),
  )

  /**
   * 本物は ULID 降順で返す。ULID は単調増加なので、採番順の逆＝新しい順。
   * `filter` が新しい配列を返すため、`reverse` は保持している値を壊さない。
   */
  const byTakeNewestFirst = (takeId: ReviewRun['takeId']): ReviewRun[] =>
    runs.filter((run) => run.takeId === takeId).reverse()

  return {
    // 偽物なので projectId は見ず、全 run を合算する（テストは 1 プロジェクトしか作らない）。
    sumCostByProject: () =>
      Promise.resolve({
        runCount: runs.length,
        totalUsd: runs.reduce((total, run) => total + run.costUsd, 0),
      }),

    snapshotRuns: () => runs,
    snapshotFindings: () => findings,

    findRunById: (id) => Promise.resolve(runs.find((run) => run.id === id) ?? null),

    findRunsByTake: (takeId) => Promise.resolve(byTakeNewestFirst(takeId)),

    findLatestRunByTake: (takeId) => Promise.resolve(byTakeNewestFirst(takeId)[0] ?? null),

    createRun: (input) => {
      const validated = CreateReviewRunInputSchema.parse(input)
      const created = ReviewRunSchema.parse({
        ...validated,
        reviewers: [...validated.reviewers],
        id: newId(ReviewRunIdSchema),
        createdAt: REVIEW_RUN_CREATED_AT,
      })
      runs = [...runs, created]
      return Promise.resolve(created)
    },

    completeRun: (id, outcome) => {
      const current = runs.find((run) => run.id === id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('ReviewRun', id))
      const validated = ReviewRunOutcomeSchema.parse(outcome)
      const updated = ReviewRunSchema.parse({ ...current, ...validated })
      runs = runs.map((run) => (run.id === id ? updated : run))
      return Promise.resolve(updated)
    },

    addFindings: (runId: ReviewRunId, inputs) => {
      // 空配列は「指摘なし」。本物と同じく例外にしない。
      if (inputs.length === 0) return Promise.resolve([])

      const created = inputs.map((input) =>
        ReviewFindingSchema.parse({
          ...CreateReviewFindingInputSchema.parse(input),
          reviewRunId: runId,
          id: newId(ReviewFindingIdSchema),
        }),
      )
      findings = [...findings, ...created]
      return Promise.resolve(created)
    },

    /** 本物は ULID 昇順＝追記順。 */
    findFindingsByRun: (runId) =>
      Promise.resolve(findings.filter((finding) => finding.reviewRunId === runId)),
  }
}
