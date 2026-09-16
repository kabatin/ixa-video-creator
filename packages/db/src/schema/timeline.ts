import { doublePrecision, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import type { TimelineClipContent, TimelineTrack } from '@ixa/domain'
import { TimelineTrack as TimelineTrackSchema } from '@ixa/domain'
import { createdAt, deletedAt, seconds, ulidPk, ulidRef } from './columns.js'
import { projects } from './workspace.js'

/**
 * DOMAIN.md §13 TimelineClip。
 * VIDEO1 は Shot の投影なので TimelineClip を持たない（ADR-0002）。
 * track は VFX / TEXT / VIDEO2 / SFX のみ。
 */
export const timelineClips = pgTable(
  'timeline_clips',
  {
    id: ulidPk(),
    projectId: ulidRef('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    track: text('track', { enum: TimelineTrackSchema.options }).$type<TimelineTrack>().notNull(),
    startSec: seconds('start_sec').notNull(),
    durationSec: seconds('duration_sec').notNull(),
    /** 同トラック内の重なり順 */
    layer: integer('layer').notNull().default(0),
    content: jsonb('content').$type<TimelineClipContent>().notNull(),
    opacity: doublePrecision('opacity').notNull().default(1),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('timeline_clips_project_id_track_idx').on(t.projectId, t.track)],
)
