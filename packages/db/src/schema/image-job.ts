import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import {
  ImageGenerationJobStatus as ImageGenerationJobStatusSchema,
  type ImageGenerationJobError,
  type ImageGenerationJobStatus,
} from '@ixa/domain'
import { timestampTz, ulidPk, ulidRef } from './columns.js'
import { mediaAssets } from './media.js'
import { shots } from './shot.js'
import { projects } from './workspace.js'

/**
 * 絵コンテの画像を作るジョブ（ADR-0029）。Shot の「最初のフレーム」になる絵を 1 枚作る。
 *
 * ★ 追記のみ。作り直しは新しい行を足す（前の絵と記録は残す）。更新は状態の遷移
 *   （queued → running → succeeded / failed）と、そのとき決まる列だけ。
 */
export const imageGenerationJobs = pgTable(
  'image_generation_jobs',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    shotId: ulidRef('shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ImageGenerationJobStatusSchema.options })
      .$type<ImageGenerationJobStatus>()
      .notNull(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    /** 参照に使った素材。実行時に決まるので、待っている間は空。 */
    referenceAssetIds: text('reference_asset_ids').array().notNull().default([]),
    /** できた絵。成功したときだけ。 */
    mediaAssetId: ulidRef('media_asset_id').references(() => mediaAssets.id),
    error: jsonb('error').$type<ImageGenerationJobError>(),
    /** 再現用の記録（CLI の版・終了コードなど）。指示の本文は入れない。 */
    providerRecord: jsonb('provider_record').$type<Record<string, unknown>>(),
    queuedAt: timestampTz('queued_at').notNull().defaultNow(),
    startedAt: timestampTz('started_at'),
    finishedAt: timestampTz('finished_at'),
  },
  (t) => [
    index('image_generation_jobs_shot_id_idx').on(t.shotId),
    index('image_generation_jobs_project_status_idx').on(t.projectId, t.status),
  ],
)
