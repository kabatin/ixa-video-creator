import { and, asc, eq, isNull } from 'drizzle-orm'
import type {
  CreateTimelineClipInput, ProjectId, TimelineClip, TimelineClipId, UpdateTimelineClipPatch,
} from '@ixa/domain'
import {
  CreateTimelineClipInput as CreateTimelineClipInputSchema,
  TimelineClip as TimelineClipSchema,
  TimelineClipId as TimelineClipIdSchema,
  UpdateTimelineClipPatch as UpdateTimelineClipPatchSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { timelineClips } from '../schema/timeline.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type TimelineClipRow = typeof timelineClips.$inferSelect

/**
 * TimelineClip の読み書き。戻り値は必ず `@ixa/domain` の型。
 * VIDEO1 は Shot の投影なので、ここには現れない（ADR-0002）。
 */
export type TimelineClipRepository = {
  /** 投入順（ULID の昇順 = 時系列）。ソフトデリート済みは含まない。 */
  findByProject(projectId: ProjectId): Promise<TimelineClip[]>
  create(input: CreateTimelineClipInput): Promise<TimelineClip>
  update(id: TimelineClipId, patch: UpdateTimelineClipPatch): Promise<TimelineClip>
  softDelete(id: TimelineClipId): Promise<void>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const timelineClipRowToDomain = (row: TimelineClipRow): TimelineClip =>
  TimelineClipSchema.parse({
    id: row.id,
    projectId: row.projectId,
    track: row.track,
    startSec: row.startSec,
    durationSec: row.durationSec,
    layer: row.layer,
    content: row.content,
    opacity: row.opacity,
    createdAt: row.createdAt,
  })

const liveById = (id: TimelineClipId) =>
  and(eq(timelineClips.id, id), isNull(timelineClips.deletedAt))

export const createTimelineClipRepository = (db: DbClient): TimelineClipRepository => ({
  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(timelineClips)
      .where(and(eq(timelineClips.projectId, projectId), isNull(timelineClips.deletedAt)))
      .orderBy(asc(timelineClips.id))
    return rows.map(timelineClipRowToDomain)
  },

  async create(input) {
    const validated = CreateTimelineClipInputSchema.parse(input)
    const rows = await db
      .insert(timelineClips)
      .values({ ...validated, id: newId(TimelineClipIdSchema), createdAt: new Date() })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('timeline_clips への INSERT が行を返しませんでした')
    return timelineClipRowToDomain(row)
  },

  async update(id, patch) {
    const validated = UpdateTimelineClipPatchSchema.parse(patch)
    const rows = await db.update(timelineClips).set(validated).where(liveById(id)).returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('TimelineClip', id)
    return timelineClipRowToDomain(row)
  },

  async softDelete(id) {
    const rows = await db
      .update(timelineClips)
      .set({ deletedAt: new Date() })
      .where(liveById(id))
      .returning({ id: timelineClips.id })
    if (rows.length === 0) throw new DbNotFoundError('TimelineClip', id)
  },
})
