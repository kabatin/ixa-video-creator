import { doublePrecision, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import type { ReviewFinding, ReviewRun, ReviewerType, Severity, Verdict } from '@ixa/domain'
import {
  ReviewerType as ReviewerTypeSchema,
  Severity as SeveritySchema,
  Verdict as VerdictSchema,
} from '@ixa/domain'
import { createdAt, ulidPk, ulidRef } from './columns.js'
import { takes } from './generation.js'

/** DOMAIN.md §11 ReviewRun。1 Take に対するレビュー実行 1 回分。 */
export const reviewRuns = pgTable(
  'review_runs',
  {
    id: ulidPk(),
    takeId: ulidRef('take_id')
      .notNull()
      .references(() => takes.id, { onDelete: 'cascade' }),
    reviewers: text('reviewers').array().$type<ReviewerType[]>().notNull().default([]),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] })
      .$type<ReviewRun['status']>()
      .notNull(),
    verdict: text('verdict', { enum: VerdictSchema.options }).$type<Verdict>(),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('review_runs_take_id_idx').on(t.takeId)],
)

/** DOMAIN.md §11 ReviewFinding。evidence は UI で指摘箇所を出すための JSONB。 */
export const reviewFindings = pgTable(
  'review_findings',
  {
    id: ulidPk(),
    reviewRunId: ulidRef('review_run_id')
      .notNull()
      .references(() => reviewRuns.id, { onDelete: 'cascade' }),
    reviewer: text('reviewer', { enum: ReviewerTypeSchema.options }).$type<ReviewerType>().notNull(),
    severity: text('severity', { enum: SeveritySchema.options }).$type<Severity>().notNull(),
    /** 0..1 */
    score: doublePrecision('score'),
    message: text('message').notNull(),
    evidence: jsonb('evidence').$type<NonNullable<ReviewFinding['evidence']>>(),
    /** 再生成ループが機械的に使う */
    suggestedPromptDelta: text('suggested_prompt_delta'),
  },
  (t) => [index('review_findings_review_run_id_idx').on(t.reviewRunId)],
)
