import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
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
import type { DbExecutor } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { timelineClips } from '../schema/timeline.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type TimelineClipRow = typeof timelineClips.$inferSelect

/**
 * 作るクリップ。**`id` は省ける**（省けばここで振る）。取り消しの記録は書く前に作るので、
 * 作る前に ID を決めておきたい呼び手（クリップの作成・歌詞の置き直し）だけが渡す。
 */
export type NewTimelineClip = CreateTimelineClipInput & { readonly id?: TimelineClipId }

/**
 * TimelineClip の読み書き。戻り値は必ず `@ixa/domain` の型。
 * VIDEO1 は Shot の投影なので、ここには現れない（ADR-0002）。
 */
export type TimelineClipRepository = {
  /** 投入順（ULID の昇順 = 時系列）。ソフトデリート済みは含まない。 */
  findByProject(projectId: ProjectId): Promise<TimelineClip[]>
  /** 1 件。ソフトデリート済み・無ければ null（更新の前に今の形を読む。ADR-0050）。 */
  findById(id: TimelineClipId): Promise<TimelineClip | null>
  create(input: NewTimelineClip): Promise<TimelineClip>
  update(id: TimelineClipId, patch: UpdateTimelineClipPatch): Promise<TimelineClip>
  /** 消したクリップを返す（ナレーションのテロップなら、どの行のものかを見るため）。 */
  softDelete(id: TimelineClipId): Promise<TimelineClip>
  /**
   * 消したクリップを戻す（取り消し。2026-10-19）。**同じ ID・同じ中身のまま**論理削除を外す。
   * 消していない・無いなら `null`（呼ぶ側が理由を出す）。
   */
  restore(id: TimelineClipId): Promise<TimelineClip | null>
  /**
   * いくつか消して、いくつか置く（歌詞のテロップの置き直し。ADR-0033）。**1 トランザクションで**行う。
   * 途中で落ちて半分だけ差し替わると、前の歌詞と新しい歌詞が帯に混ざる。消す相手が無ければ `DbNotFoundError`。
   */
  replace(
    removeIds: readonly TimelineClipId[],
    inputs: readonly NewTimelineClip[],
  ): Promise<TimelineClip[]>
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

/** 渡された ID は検証してから使う（規約 4）。無ければ振る。 */
const idOf = (input: NewTimelineClip): TimelineClipId =>
  input.id === undefined ? newId(TimelineClipIdSchema) : TimelineClipIdSchema.parse(input.id)

const liveById = (id: TimelineClipId) =>
  and(eq(timelineClips.id, id), isNull(timelineClips.deletedAt))

export const createTimelineClipRepository = (db: DbExecutor): TimelineClipRepository => ({
  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(timelineClips)
      .where(and(eq(timelineClips.projectId, projectId), isNull(timelineClips.deletedAt)))
      .orderBy(asc(timelineClips.id))
    return rows.map(timelineClipRowToDomain)
  },

  async findById(id) {
    const rows = await db.select().from(timelineClips).where(liveById(id)).limit(1)
    const row = rows[0]
    return row === undefined ? null : timelineClipRowToDomain(row)
  },

  async create(input) {
    const validated = CreateTimelineClipInputSchema.parse(input)
    const rows = await db
      .insert(timelineClips)
      .values({ ...validated, id: idOf(input), createdAt: new Date() })
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
      .returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('TimelineClip', id)
    return timelineClipRowToDomain(row)
  },

  async restore(id) {
    const rows = await db
      .update(timelineClips)
      .set({ deletedAt: null })
      .where(and(eq(timelineClips.id, id), isNotNull(timelineClips.deletedAt)))
      .returning()
    const row = rows[0]
    return row === undefined ? null : timelineClipRowToDomain(row)
  },

  async replace(removeIds, inputs) {
    const validated = inputs.map((input) => ({ ...CreateTimelineClipInputSchema.parse(input), id: idOf(input) }))
    return db.transaction(async (tx) => {
      const now = new Date()
      for (const id of removeIds) {
        const removed = await tx
          .update(timelineClips)
          .set({ deletedAt: now })
          .where(liveById(id))
          .returning({ id: timelineClips.id })
        if (removed.length === 0) throw new DbNotFoundError('TimelineClip', id)
      }
      if (validated.length === 0) return []
      const rows = await tx
        .insert(timelineClips)
        .values(validated.map((input) => ({ ...input, createdAt: now })))
        .returning()
      return rows.map(timelineClipRowToDomain)
    })
  },
})
