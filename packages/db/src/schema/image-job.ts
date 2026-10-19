import { doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  ImageCheckOutcome as ImageCheckOutcomeSchema,
  ImageCheckVerdict as ImageCheckVerdictSchema,
  ImageGenerationJobStatus as ImageGenerationJobStatusSchema,
  ImageJobKind as ImageJobKindSchema,
  type ImageCheckIssue,
  type ImageCheckOutcome,
  type ImageCheckVerdict,
  type ImageGenerationJobError,
  type ImageGenerationJobStatus,
  type ImageJobKind,
} from '@ixa/domain'
import { timestampTz, ulidPk, ulidRef } from './columns.js'
import { mediaAssets } from './media.js'
import { characters } from './character.js'
import { shots } from './shot.js'
import { projects } from './workspace.js'

/**
 * 絵を 1 枚作るジョブ（ADR-0029）。種類は `start_frame`（Shot の最初のフレーム）と
 * `character_sheet`（キャラクターシート。ADR-0035）・`key_art`（サムネイルの背景。ADR-0051）。Codex は 1 度に 1 枚なので同じ表・同じ順番待ち。
 * 持ち主は種類で決まる（最初のフレームは shot_id、シートは character_id、キーアートはどちらも null。
 * domain の `imageJobViolation` が縛る）。
 *
 * ★ 追記のみ。作り直しは新しい行を足す（前の絵と記録は残す）。更新は状態の遷移
 *   （queued → running → checking → succeeded / failed）と、そのとき決まる列だけ。
 *   やり直しは前のジョブを `retry_of_job_id` で指す新しい行（ADR-0055）。
 */
export const imageGenerationJobs = pgTable(
  'image_generation_jobs',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ImageJobKindSchema.options }).$type<ImageJobKind>().notNull().default('start_frame'),
    shotId: ulidRef('shot_id').references(() => shots.id, { onDelete: 'cascade' }),
    characterId: ulidRef('character_id').references(() => characters.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ImageGenerationJobStatusSchema.options })
      .$type<ImageGenerationJobStatus>()
      .notNull(),
    /** キーアートに添えた自由な指示（ADR-0051）。ほかの種類は null。 */
    instruction: text('instruction'),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    /** 参照に使った素材。実行時に決まるので、待っている間は空。 */
    referenceAssetIds: text('reference_asset_ids').array().notNull().default([]),
    /** できた絵。成功したときだけ。 */
    mediaAssetId: ulidRef('media_asset_id').references(() => mediaAssets.id),
    error: jsonb('error').$type<ImageGenerationJobError>(),
    /** 再現用の記録（CLI の版・終了コードなど）。指示の本文は入れない。 */
    providerRecord: jsonb('provider_record').$type<Record<string, unknown>>(),
    /** やり直しのとき、前のジョブ（ADR-0055）。1 枚目は null。 */
    retryOfJobId: ulidRef('retry_of_job_id').references((): AnyPgColumn => imageGenerationJobs.id, {
      onDelete: 'set null',
    }),
    /** 何枚目の試しか。1 から数える。 */
    attempt: integer('attempt').notNull().default(1),
    /** つながりの最後にこの絵を当てたとき（ADR-0055）。当てていなければ null。 */
    appliedAt: timestampTz('applied_at'),
    queuedAt: timestampTz('queued_at').notNull().defaultNow(),
    startedAt: timestampTz('started_at'),
    finishedAt: timestampTz('finished_at'),
  },
  (t) => [
    index('image_generation_jobs_shot_id_idx').on(t.shotId),
    index('image_generation_jobs_character_id_idx').on(t.characterId),
    index('image_generation_jobs_project_status_idx').on(t.projectId, t.status),
    index('image_generation_jobs_retry_of_job_id_idx').on(t.retryOfJobId),
    index('image_generation_jobs_media_asset_id_idx').on(t.mediaAssetId),
  ],
)

/**
 * 作った絵のチェック（ADR-0055）。**ジョブに 1 行・追記のみ。** 見た・飛ばした・落ちたを `outcome` で分ける
 * （飛ばした・落ちたを「合格」に化けさせない）。
 */
export const imageChecks = pgTable(
  'image_checks',
  {
    id: ulidPk(),
    imageJobId: ulidRef('image_job_id')
      .notNull()
      .references(() => imageGenerationJobs.id, { onDelete: 'cascade' }),
    outcome: text('outcome', { enum: ImageCheckOutcomeSchema.options }).$type<ImageCheckOutcome>().notNull(),
    verdict: text('verdict', { enum: ImageCheckVerdictSchema.options }).$type<ImageCheckVerdict>(),
    score: doublePrecision('score'),
    issues: jsonb('issues').$type<ImageCheckIssue[]>().notNull().default([]),
    promptDelta: text('prompt_delta'),
    /** 飛ばした・落ちた理由（利用者に見せる文）。 */
    note: text('note'),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    createdAt: timestampTz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('image_checks_image_job_id_idx').on(t.imageJobId)],
)
