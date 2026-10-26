import { boolean, doublePrecision, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import type { MasteringMode, RenderJob, RenderPreset, RenderScope, TimelineDocument } from '@ixa/domain'
import { MasteringMode as MasteringModeSchema, RenderPreset as RenderPresetSchema } from '@ixa/domain'
import { createdAt, timestampTz, ulidPk, ulidRef } from './columns.js'
import { mediaAssets } from './media.js'
import { projects } from './workspace.js'

/**
 * DOMAIN.md §14 RenderJob。
 * timeline_snapshot は Immutable。何をレンダリングしたかが常に分かる。
 */
export const renderJobs = pgTable(
  'render_jobs',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    scope: jsonb('scope').$type<RenderScope>().notNull(),
    preset: text('preset', { enum: RenderPresetSchema.options }).$type<RenderPreset>().notNull(),
    timelineSnapshot: jsonb('timeline_snapshot').$type<TimelineDocument>().notNull(),
    status: text('status', {
      enum: ['queued', 'rendering', 'encoding', 'succeeded', 'failed', 'cancelled'],
    })
      .$type<RenderJob['status']>()
      .notNull(),
    /** 0..1 */
    progress: doublePrecision('progress').notNull().default(0),
    outputAssetId: ulidRef('output_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    error: text('error'),
    /** 書き出しの音量を揃えるか（ADR-0039）。 */
    normalizeLoudness: boolean('normalize_loudness').notNull().default(true),
    /** 揃えるときの仕上げ（ADR-0060）。投入の時点で作品の設定から決めて控える。前からのジョブは loudnorm。 */
    masteringMode: text('mastering_mode', { enum: MasteringModeSchema.options }).$type<MasteringMode>().notNull().default('loudnorm'),
    /** 揃えた後に測った大きさ（LUFS）。 */
    loudnessLufs: doublePrecision('loudness_lufs'),
    createdAt: createdAt(),
    finishedAt: timestampTz('finished_at'),
  },
  (t) => [index('render_jobs_project_id_idx').on(t.projectId)],
)
