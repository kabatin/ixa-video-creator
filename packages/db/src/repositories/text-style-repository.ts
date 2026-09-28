import { and, asc, eq, isNull } from 'drizzle-orm'
import type {
  CreateTextStylePresetInput,
  ProjectId,
  TextStyleId,
  TextStylePreset,
  UpdateTextStylePresetPatch,
} from '@ixa/domain'
import {
  CreateTextStylePresetInput as CreateSchema,
  TextStyleId as TextStyleIdSchema,
  TextStylePreset as TextStylePresetSchema,
  UpdateTextStylePresetPatch as UpdateSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { textStyles } from '../schema/text-style.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type TextStyleRow = typeof textStyles.$inferSelect

/** 保存したテロップの見た目の読み書き（ADR-0028）。戻り値は必ず `@ixa/domain` の型。 */
export type TextStyleRepository = {
  /** 作った順。論理削除済みは含まない。 */
  findByProject(projectId: ProjectId): Promise<TextStylePreset[]>
  findById(id: TextStyleId): Promise<TextStylePreset | null>
  /** 同じプロジェクトに同じ名前があるか（作る・名前を変える前に確かめる）。 */
  findByName(projectId: ProjectId, name: string): Promise<TextStylePreset | null>
  create(projectId: ProjectId, input: CreateTextStylePresetInput): Promise<TextStylePreset>
  update(id: TextStyleId, patch: UpdateTextStylePresetPatch): Promise<TextStylePreset>
  softDelete(id: TextStyleId): Promise<void>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const textStyleRowToDomain = (row: TextStyleRow): TextStylePreset =>
  TextStylePresetSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    style: row.style,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

const live = isNull(textStyles.deletedAt)

export const createTextStyleRepository = (db: DbClient): TextStyleRepository => ({
  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(textStyles)
      .where(and(eq(textStyles.projectId, projectId), live))
      .orderBy(asc(textStyles.id))
    return rows.map(textStyleRowToDomain)
  },

  async findById(id) {
    const rows = await db.select().from(textStyles).where(and(eq(textStyles.id, id), live))
    const row = rows[0]
    return row === undefined ? null : textStyleRowToDomain(row)
  },

  async findByName(projectId, name) {
    const rows = await db
      .select()
      .from(textStyles)
      .where(and(eq(textStyles.projectId, projectId), eq(textStyles.name, name.trim()), live))
    const row = rows[0]
    return row === undefined ? null : textStyleRowToDomain(row)
  },

  async create(projectId, input) {
    const validated = CreateSchema.parse(input)
    const now = new Date()
    const rows = await db
      .insert(textStyles)
      .values({ ...validated, id: newId(TextStyleIdSchema), projectId, createdAt: now, updatedAt: now })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('text_styles への INSERT が行を返しませんでした')
    return textStyleRowToDomain(row)
  },

  async update(id, patch) {
    const validated = UpdateSchema.parse(patch)
    const rows = await db
      .update(textStyles)
      .set({ ...validated, updatedAt: new Date() })
      .where(and(eq(textStyles.id, id), live))
      .returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('TextStyle', id)
    return textStyleRowToDomain(row)
  },

  async softDelete(id) {
    const rows = await db
      .update(textStyles)
      .set({ deletedAt: new Date() })
      .where(and(eq(textStyles.id, id), live))
      .returning({ id: textStyles.id })
    if (rows.length === 0) throw new DbNotFoundError('TextStyle', id)
  },
})
