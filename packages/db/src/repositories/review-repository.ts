import { asc, desc, eq, sql } from 'drizzle-orm'
import type {
  CreateReviewFindingInput,
  CreateReviewRunInput,
  ReviewFinding,
  ReviewRun,
  ProjectId,
  ReviewRunId,
  ReviewRunOutcome,
  TakeId,
} from '@ixa/domain'
import {
  CreateReviewFindingInput as CreateReviewFindingInputSchema,
  CreateReviewRunInput as CreateReviewRunInputSchema,
  ReviewFinding as ReviewFindingSchema,
  ReviewFindingId as ReviewFindingIdSchema,
  ReviewRun as ReviewRunSchema,
  ReviewRunId as ReviewRunIdSchema,
  ReviewRunOutcome as ReviewRunOutcomeSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { takes } from '../schema/generation.js'
import { reviewFindings, reviewRuns } from '../schema/review.js'
import { shots } from '../schema/shot.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ReviewRunRow = typeof reviewRuns.$inferSelect
export type ReviewFindingRow = typeof reviewFindings.$inferSelect

/**
 * ReviewRun と ReviewFinding の読み書き（DOMAIN.md §11）。
 * 戻り値は必ず `@ixa/domain` の型。
 *
 * **判定は追記のみ。** 既存の ReviewRun の指摘を書き換える口は用意しない。
 * 判定をやり直すなら新しい ReviewRun を作る（Take の Immutability と同じ考え方・ADR-0003）。
 * 後から動くのは `status` / `verdict` / `costUsd` だけで、これは実行の進行そのものを表す。
 */
export type ReviewRepository = {
  findRunById(id: ReviewRunId): Promise<ReviewRun | null>
  /** 直近の実行が先頭（ULID 降順）。Take のレビュー履歴をそのまま表示できる並び。 */
  findRunsByTake(takeId: TakeId): Promise<ReviewRun[]>
  /** 最新の 1 件。無ければ null。 */
  findLatestRunByTake(takeId: TakeId): Promise<ReviewRun | null>
  /**
   * Project 内のレビュー実行の総額と件数。**費用メーター（P63-2）が使う。**
   * 生成だけが金を使うわけではない。数えないと予算が実際より軽く見える。
   * 論理削除済み Shot の Take のレビューも含める（払った額は戻らない）。
   */
  sumCostByProject(projectId: ProjectId): Promise<{ runCount: number; totalUsd: number }>
  createRun(input: CreateReviewRunInput): Promise<ReviewRun>
  /** 実行の結果を確定させる。ここ以外で ReviewRun を UPDATE しない。 */
  completeRun(id: ReviewRunId, outcome: ReviewRunOutcome): Promise<ReviewRun>
  /**
   * 指摘をまとめて追記する。**1 トランザクションで入れる。**
   * 途中で失敗して half の指摘だけ残ると、verdict と指摘の数が食い違う。
   * 空配列は「指摘なし」を意味するので、例外にせず空配列を返す。
   */
  addFindings(
    runId: ReviewRunId,
    inputs: readonly CreateReviewFindingInput[],
  ): Promise<ReviewFinding[]>
  /** 追記順（ULID 昇順）。 */
  findFindingsByRun(runId: ReviewRunId): Promise<ReviewFinding[]>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const reviewRunRowToDomain = (row: ReviewRunRow): ReviewRun =>
  ReviewRunSchema.parse({
    id: row.id,
    takeId: row.takeId,
    reviewers: row.reviewers,
    status: row.status,
    verdict: row.verdict,
    costUsd: row.costUsd,
    createdAt: row.createdAt,
  })

export const reviewFindingRowToDomain = (row: ReviewFindingRow): ReviewFinding =>
  ReviewFindingSchema.parse({
    id: row.id,
    reviewRunId: row.reviewRunId,
    reviewer: row.reviewer,
    severity: row.severity,
    score: row.score,
    message: row.message,
    evidence: row.evidence,
    suggestedPromptDelta: row.suggestedPromptDelta,
  })

export const createReviewRepository = (db: DbClient): ReviewRepository => ({
  async findRunById(id) {
    const rows = await db.select().from(reviewRuns).where(eq(reviewRuns.id, id)).limit(1)
    const row = rows[0]
    return row ? reviewRunRowToDomain(row) : null
  },

  async findRunsByTake(takeId) {
    const rows = await db
      .select()
      .from(reviewRuns)
      .where(eq(reviewRuns.takeId, takeId))
      .orderBy(desc(reviewRuns.id))
    return rows.map(reviewRunRowToDomain)
  },

  async findLatestRunByTake(takeId) {
    const rows = await db
      .select()
      .from(reviewRuns)
      .where(eq(reviewRuns.takeId, takeId))
      .orderBy(desc(reviewRuns.id))
      .limit(1)
    const row = rows[0]
    return row ? reviewRunRowToDomain(row) : null
  },

  sumCostByProject: async (projectId) => {
    // review_runs は take_id しか持たないので takes → shots を経由する。
    // **論理削除の絞り込みはしない**（takes の sumCostByProject と同じ数え方）。
    const rows = await db
      .select({
        runCount: sql<string>`count(*)`,
        totalUsd: sql<string>`coalesce(sum(${reviewRuns.costUsd}), 0)`,
      })
      .from(reviewRuns)
      .innerJoin(takes, eq(takes.id, reviewRuns.takeId))
      .innerJoin(shots, eq(shots.id, takes.shotId))
      .where(eq(shots.projectId, projectId))
    return {
      runCount: Number(rows[0]?.runCount ?? 0),
      totalUsd: Number(rows[0]?.totalUsd ?? 0),
    }
  },

  async createRun(input) {
    const validated = CreateReviewRunInputSchema.parse(input)
    const rows = await db
      .insert(reviewRuns)
      .values({ ...validated, reviewers: [...validated.reviewers], id: newId(ReviewRunIdSchema) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('review_runs への INSERT が行を返しませんでした')
    return reviewRunRowToDomain(row)
  },

  async completeRun(id, outcome) {
    const validated = ReviewRunOutcomeSchema.parse(outcome)
    const rows = await db
      .update(reviewRuns)
      .set(validated)
      .where(eq(reviewRuns.id, id))
      .returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('ReviewRun', id)
    return reviewRunRowToDomain(row)
  },

  async addFindings(runId, inputs) {
    if (inputs.length === 0) return []

    const validated = inputs.map((input) => CreateReviewFindingInputSchema.parse(input))
    const rows = await db
      .insert(reviewFindings)
      .values(
        validated.map((finding) => ({
          ...finding,
          reviewRunId: runId,
          id: newId(ReviewFindingIdSchema),
        })),
      )
      .returning()
    return rows.map(reviewFindingRowToDomain)
  },

  async findFindingsByRun(runId) {
    const rows = await db
      .select()
      .from(reviewFindings)
      .where(eq(reviewFindings.reviewRunId, runId))
      .orderBy(asc(reviewFindings.id))
    return rows.map(reviewFindingRowToDomain)
  },
})
