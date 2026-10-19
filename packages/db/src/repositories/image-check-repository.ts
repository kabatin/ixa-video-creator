import { eq, inArray } from 'drizzle-orm'
import {
  ImageCheck as ImageCheckSchema,
  ImageCheckId as ImageCheckIdSchema,
  imageCheckViolation,
  newId,
  type ImageCheck,
  type ImageGenerationJobId,
} from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { imageChecks } from '../schema/image-job.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ImageCheckRow = typeof imageChecks.$inferSelect

/** 残すときの入力。id と時刻はここで決める。 */
export type CreateImageCheckInput = Omit<ImageCheck, 'id' | 'createdAt'>

/** 作った絵のチェックの読み書き（ADR-0055）。**追記のみ・ジョブに 1 行。** */
export type ImageCheckRepository = {
  /** 残す。同じジョブの行が既にあれば書かずに、そちらを返す（チェックの手順を投げ直しても二重に払わない）。 */
  create(input: CreateImageCheckInput): Promise<ImageCheck>
  findByJobId(imageJobId: ImageGenerationJobId): Promise<ImageCheck | null>
  findByJobIds(imageJobIds: readonly ImageGenerationJobId[]): Promise<ImageCheck[]>
}

/** row → Domain。食い違う行は黙って読み替えずに止める。 */
export const imageCheckRowToDomain = (row: ImageCheckRow): ImageCheck => {
  const check = ImageCheckSchema.parse(row)
  const violation = imageCheckViolation(check)
  if (violation !== null) throw new Error(`絵のチェック ${row.id} の記録が壊れています: ${violation}`)
  return check
}

export const createImageCheckRepository = (db: DbExecutor): ImageCheckRepository => {
  const findByJobId = async (imageJobId: ImageGenerationJobId): Promise<ImageCheck | null> => {
    const rows = await db.select().from(imageChecks).where(eq(imageChecks.imageJobId, imageJobId)).limit(1)
    const row = rows[0]
    return row === undefined ? null : imageCheckRowToDomain(row)
  }

  return {
    async create(input) {
      const parsed = ImageCheckSchema.parse({ ...input, id: newId(ImageCheckIdSchema), createdAt: new Date() })
      const violation = imageCheckViolation(parsed)
      if (violation !== null) throw new Error(`絵のチェックを残せません: ${violation}`)
      const rows = await db
        .insert(imageChecks)
        .values({ ...parsed, issues: [...parsed.issues] })
        .onConflictDoNothing({ target: imageChecks.imageJobId })
        .returning()
      const row = rows[0]
      if (row !== undefined) return imageCheckRowToDomain(row)
      const existing = await findByJobId(parsed.imageJobId)
      if (existing === null) throw new Error(`絵のチェックを残せませんでした（ジョブ ${parsed.imageJobId}）`)
      return existing
    },

    findByJobId,

    async findByJobIds(imageJobIds) {
      if (imageJobIds.length === 0) return []
      const rows = await db.select().from(imageChecks).where(inArray(imageChecks.imageJobId, [...imageJobIds]))
      return rows.map(imageCheckRowToDomain)
    },
  }
}
