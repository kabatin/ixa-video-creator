import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  CreateNarrationLineInput as CreateSchema,
  NarrationLine as NarrationLineSchema,
  NarrationLineId as NarrationLineIdSchema,
  UpdateNarrationLinePatch as UpdateSchema,
  newId,
  type CreateNarrationLineInput,
  type NarrationLine,
  type NarrationLineId,
  type ProjectId,
  type UpdateNarrationLinePatch,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { narrationLines } from '../schema/narration.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type NarrationLineRow = typeof narrationLines.$inferSelect

/** 原稿の行の読み書き（ADR-0038）。戻り値は必ず `@ixa/domain` の型。 */
export type NarrationLineRepository = {
  /** 並び順。論理削除済みは含まない。 */
  findByProject(projectId: ProjectId): Promise<NarrationLine[]>
  findById(id: NarrationLineId): Promise<NarrationLine | null>
  /** まとめて作る（原稿を貼り付けたとき・録音を行に分けたとき）。1 つの取引で。 */
  createMany(inputs: readonly CreateNarrationLineInput[]): Promise<NarrationLine[]>
  update(id: NarrationLineId, patch: UpdateNarrationLinePatch): Promise<NarrationLine>
  /** 並び順を、渡した順に振り直す（作品の行だけ）。 */
  reorder(projectId: ProjectId, ids: readonly NarrationLineId[]): Promise<NarrationLine[]>
  softDelete(id: NarrationLineId): Promise<void>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const narrationLineRowToDomain = (row: NarrationLineRow): NarrationLine =>
  NarrationLineSchema.parse({
    id: row.id,
    projectId: row.projectId,
    order: row.order,
    text: row.text,
    reading: row.reading,
    voiceProfileId: row.voiceProfileId,
    direction: row.direction,
    startSec: row.startSec,
    selectedTakeId: row.selectedTakeId,
    telop: row.telop,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

const live = isNull(narrationLines.deletedAt)

export const createNarrationLineRepository = (db: DbClient): NarrationLineRepository => ({
  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(narrationLines)
      .where(and(eq(narrationLines.projectId, projectId), live))
      .orderBy(asc(narrationLines.order), asc(narrationLines.id))
    return rows.map(narrationLineRowToDomain)
  },

  async findById(id) {
    const rows = await db.select().from(narrationLines).where(and(eq(narrationLines.id, id), live))
    const row = rows[0]
    return row === undefined ? null : narrationLineRowToDomain(row)
  },

  async createMany(inputs) {
    if (inputs.length === 0) return []
    const values = inputs.map((input) => ({ id: newId(NarrationLineIdSchema), ...CreateSchema.parse(input) }))
    const rows = await db.insert(narrationLines).values(values).returning()
    return rows.map(narrationLineRowToDomain)
  },

  async update(id, patch) {
    const valid = UpdateSchema.parse(patch)
    const rows = await db
      .update(narrationLines)
      .set({ ...valid, updatedAt: new Date() })
      .where(and(eq(narrationLines.id, id), live))
      .returning()
    const row = rows[0]
    if (row === undefined) throw new DbNotFoundError('narration_lines', id)
    return narrationLineRowToDomain(row)
  },

  async reorder(projectId, ids) {
    await db.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx
          .update(narrationLines)
          .set({ order: index, updatedAt: new Date() })
          .where(and(eq(narrationLines.id, id), eq(narrationLines.projectId, projectId), live))
      }
    })
    const rows = await db
      .select()
      .from(narrationLines)
      .where(and(eq(narrationLines.projectId, projectId), inArray(narrationLines.id, [...ids]), live))
      .orderBy(asc(narrationLines.order))
    return rows.map(narrationLineRowToDomain)
  },

  async softDelete(id) {
    const rows = await db
      .update(narrationLines)
      .set({ deletedAt: new Date() })
      .where(and(eq(narrationLines.id, id), live))
      .returning({ id: narrationLines.id })
    if (rows.length === 0) throw new DbNotFoundError('narration_lines', id)
  },
})
