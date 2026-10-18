import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import type {
  BrandAsset, BrandAssetId, CreateBrandAssetInput, UpdateBrandAssetPatch, ProjectId,
} from '@ixa/domain'
import {
  BrandAsset as BrandAssetSchema,
  BrandAssetId as BrandAssetIdSchema,
  CreateBrandAssetInput as CreateBrandAssetInputSchema,
  UpdateBrandAssetPatch as UpdateBrandAssetPatchSchema,
  newId,
} from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { brandAssets } from '../schema/library.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type BrandAssetRow = typeof brandAssets.$inferSelect

/**
 * Brand Asset の読み書き（DOMAIN.md §6）。戻り値は必ず `@ixa/domain` の型。
 *
 * 「category=color なら value、それ以外は mediaAssetId」の組み合わせ規則は
 * API 境界（apps/api/src/routes/assets.ts）で検証する。ここは永続化だけを担う。
 */
export type BrandAssetRepository = {
  findById(id: BrandAssetId): Promise<BrandAsset | null>
  /** 作成順（ULID 昇順）。ソフトデリート済みは含まない。 */
  findByProject(projectId: ProjectId): Promise<BrandAsset[]>
  /** `id` は省ける（省けばここで振る）。取り消しの記録は書く前に作るので、作る前に ID を決めたい呼び手だけが渡す。 */
  create(input: CreateBrandAssetInput & { readonly id?: BrandAssetId }): Promise<BrandAsset>
  update(id: BrandAssetId, patch: UpdateBrandAssetPatch): Promise<BrandAsset>
  softDelete(id: BrandAssetId): Promise<void>
  /** 消したものを戻す（取り消し。2026-10-19）。同じ ID・同じ中身のまま論理削除を外す。消していない・無いなら `null`。 */
  restore(id: BrandAssetId): Promise<BrandAsset | null>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const brandAssetRowToDomain = (row: BrandAssetRow): BrandAsset =>
  BrandAssetSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    category: row.category,
    name: row.name,
    mediaAssetId: row.mediaAssetId,
    value: row.value,
    usageRule: row.usageRule,
  })

const liveById = (id: BrandAssetId) => and(eq(brandAssets.id, id), isNull(brandAssets.deletedAt))

export const createBrandAssetRepository = (db: DbExecutor): BrandAssetRepository => ({
  async findById(id) {
    const rows = await db.select().from(brandAssets).where(liveById(id)).limit(1)
    const row = rows[0]
    return row ? brandAssetRowToDomain(row) : null
  },

  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(brandAssets)
      .where(and(eq(brandAssets.projectId, projectId), isNull(brandAssets.deletedAt)))
      .orderBy(asc(brandAssets.id))
    return rows.map(brandAssetRowToDomain)
  },

  async create(input) {
    const validated = CreateBrandAssetInputSchema.parse(input)
    const rows = await db
      .insert(brandAssets)
      .values({ ...validated, id: input.id === undefined ? newId(BrandAssetIdSchema) : BrandAssetIdSchema.parse(input.id) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('brand_assets への INSERT が行を返しませんでした')
    return brandAssetRowToDomain(row)
  },

  async update(id, patch) {
    const validated = UpdateBrandAssetPatchSchema.parse(patch)
    const rows = await db.update(brandAssets).set(validated).where(liveById(id)).returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('BrandAsset', id)
    return brandAssetRowToDomain(row)
  },

  async softDelete(id) {
    const rows = await db
      .update(brandAssets)
      .set({ deletedAt: new Date() })
      .where(liveById(id))
      .returning({ id: brandAssets.id })
    if (rows.length === 0) throw new DbNotFoundError('BrandAsset', id)
  },

  async restore(id) {
    const rows = await db
      .update(brandAssets)
      .set({ deletedAt: null })
      .where(and(eq(brandAssets.id, id), isNotNull(brandAssets.deletedAt)))
      .returning()
    const row = rows[0]
    return row === undefined ? null : brandAssetRowToDomain(row)
  },
})
