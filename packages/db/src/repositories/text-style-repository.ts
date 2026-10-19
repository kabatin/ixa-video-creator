import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
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
import type { DbExecutor } from '../client.js'
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
  /** `id` は省ける（省けばここで振る）。取り消しの記録は書く前に作るので、作る前に ID を決めたい呼び手だけが渡す。 */
  create(projectId: ProjectId, input: CreateTextStylePresetInput & { readonly id?: TextStyleId }): Promise<TextStylePreset>
  update(id: TextStyleId, patch: UpdateTextStylePresetPatch): Promise<TextStylePreset>
  softDelete(id: TextStyleId): Promise<void>
  /**
   * 消したスタイルを戻す（取り消し。2026-10-19）。同じ ID・同じ中身のまま論理削除を外す。消していない・無いなら `null`。
   * 同じ名前のスタイルが後から作られていれば一意制約で投げる。
   */
  restore(id: TextStyleId): Promise<TextStylePreset | null>
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

export const createTextStyleRepository = (db: DbExecutor): TextStyleRepository => ({
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
      .values({
        ...validated,
        // 渡された ID は検証してから使う（規約 4）。
        id: input.id === undefined ? newId(TextStyleIdSchema) : TextStyleIdSchema.parse(input.id),
        projectId,
        createdAt: now,
        updatedAt: now,
      })
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

  async restore(id) {
    const rows = await db
      .update(textStyles)
      .set({ deletedAt: null })
      .where(and(eq(textStyles.id, id), isNotNull(textStyles.deletedAt)))
      .returning()
    const row = rows[0]
    return row === undefined ? null : textStyleRowToDomain(row)
  },
})
