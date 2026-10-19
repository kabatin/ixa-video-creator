import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import {
  CreateUploadedSfxInput as CreateUploadedSfxInputSchema,
  UploadedSfx as UploadedSfxSchema,
  UploadedSfxId as UploadedSfxIdSchema,
  newId,
  type CreateUploadedSfxInput,
  type ProjectId,
  type UploadedSfx,
} from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { uploadedSfx } from '../schema/sfx.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type UploadedSfxRow = typeof uploadedSfx.$inferSelect

/** 手元のファイルから取り込んだ効果音の読み書き（ADR-0056）。戻り値は必ず `@ixa/domain` の型。 */
export type UploadedSfxRepository = {
  /** 記す。同じ素材が作品にもう記されていれば（消した行は除く）、その行を返す（重ねて記さない）。 */
  create(input: CreateUploadedSfxInput): Promise<UploadedSfx>
  /** 作品の取り込んだ効果音（消したものは除く。新しい順）。 */
  findByProject(projectId: ProjectId): Promise<UploadedSfx[]>
}

/** row → Domain。形の違う行は黙って読み替えず失敗する。 */
export const uploadedSfxRowToDomain = (row: UploadedSfxRow): UploadedSfx =>
  UploadedSfxSchema.parse({
    id: row.id,
    projectId: row.projectId,
    mediaAssetId: row.mediaAssetId,
    title: row.title,
    createdAt: row.createdAt,
  })

export const createUploadedSfxRepository = (db: DbExecutor): UploadedSfxRepository => ({
  async create(input) {
    const validated = CreateUploadedSfxInputSchema.parse(input)
    const [row] = await db
      .insert(uploadedSfx)
      .values({ id: newId(UploadedSfxIdSchema), ...validated })
      .onConflictDoNothing({
        target: [uploadedSfx.projectId, uploadedSfx.mediaAssetId],
        where: sql`${uploadedSfx.deletedAt} is null`,
      })
      .returning()
    if (row !== undefined) return uploadedSfxRowToDomain(row)
    const [existing] = await db
      .select()
      .from(uploadedSfx)
      .where(
        and(
          eq(uploadedSfx.projectId, validated.projectId),
          eq(uploadedSfx.mediaAssetId, validated.mediaAssetId),
          isNull(uploadedSfx.deletedAt),
        ),
      )
      .limit(1)
    if (existing === undefined) throw new Error('取り込んだ効果音を記せませんでした')
    return uploadedSfxRowToDomain(existing)
  },

  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(uploadedSfx)
      .where(and(eq(uploadedSfx.projectId, projectId), isNull(uploadedSfx.deletedAt)))
      .orderBy(desc(uploadedSfx.id))
    return rows.map(uploadedSfxRowToDomain)
  },
})
