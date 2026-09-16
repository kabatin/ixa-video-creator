import { asc, eq } from 'drizzle-orm'
import type { CreateShotReferenceInput, ShotId, ShotReference, ShotReferenceId } from '@ixa/domain'
import {
  CreateShotReferenceInput as CreateShotReferenceInputSchema,
  ShotReference as ShotReferenceSchema,
  ShotReferenceId as ShotReferenceIdSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { shotReferences } from '../schema/shot.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ShotReferenceRow = typeof shotReferences.$inferSelect

/**
 * Shot に紐づく参照画像（DOMAIN.md §9 ShotReference）。
 *
 * ここに入るのは主に `sourceKind: 'manual'` の手動追加分。
 * derived_* は ReferenceResolver が生成のたびに組み立てるため、
 * 保存しなくても再現できる（ARCHITECTURE.md §8）。
 *
 * 更新口は持たない。重み・順序の付け替えは delete + create で表す。
 */
export type ShotReferenceRepository = {
  /** order 昇順。同順は id 昇順（= 追加順）で安定させる。 */
  findByShot(shotId: ShotId): Promise<ShotReference[]>
  create(input: CreateShotReferenceInput): Promise<ShotReference>
  delete(id: ShotReferenceId): Promise<void>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const shotReferenceRowToDomain = (row: ShotReferenceRow): ShotReference =>
  ShotReferenceSchema.parse({
    id: row.id,
    shotId: row.shotId,
    mediaAssetId: row.mediaAssetId,
    role: row.role,
    weight: row.weight,
    order: row.order,
    sourceKind: row.sourceKind,
  })

export const createShotReferenceRepository = (db: DbClient): ShotReferenceRepository => ({
  async findByShot(shotId) {
    const rows = await db
      .select()
      .from(shotReferences)
      .where(eq(shotReferences.shotId, shotId))
      .orderBy(asc(shotReferences.order), asc(shotReferences.id))
    return rows.map(shotReferenceRowToDomain)
  },

  async create(input) {
    const validated = CreateShotReferenceInputSchema.parse(input)
    const rows = await db
      .insert(shotReferences)
      .values({ ...validated, id: newId(ShotReferenceIdSchema) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('shot_references への INSERT が行を返しませんでした')
    return shotReferenceRowToDomain(row)
  },

  async delete(id) {
    const rows = await db
      .delete(shotReferences)
      .where(eq(shotReferences.id, id))
      .returning({ id: shotReferences.id })
    if (rows.length === 0) throw new DbNotFoundError('ShotReference', id)
  },
})
