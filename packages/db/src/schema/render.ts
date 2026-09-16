import { doublePrecision, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import type { RenderJob, RenderPreset, RenderScope, TimelineDocument } from '@ixa/domain'
import { RenderPreset as RenderPresetSchema } from '@ixa/domain'
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
    createdAt: createdAt(),
    finishedAt: timestampTz('finished_at'),
  },
  (t) => [index('render_jobs_project_id_idx').on(t.projectId)],
)
