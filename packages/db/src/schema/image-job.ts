import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import {
  ImageGenerationJobStatus as ImageGenerationJobStatusSchema,
  ImageJobKind as ImageJobKindSchema,
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
 * `character_sheet`（キャラクターシート。ADR-0035）。Codex は 1 度に 1 枚なので同じ表・同じ順番待ち。
 * 持ち主は種類で決まる（最初のフレームは shot_id、シートは character_id。domain の `imageJobViolation` が縛る）。
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
    kind: text('kind', { enum: ImageJobKindSchema.options }).$type<ImageJobKind>().notNull().default('start_frame'),
    shotId: ulidRef('shot_id').references(() => shots.id, { onDelete: 'cascade' }),
    characterId: ulidRef('character_id').references(() => characters.id, { onDelete: 'cascade' }),
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
    index('image_generation_jobs_character_id_idx').on(t.characterId),
    index('image_generation_jobs_project_status_idx').on(t.projectId, t.status),
  ],
)
