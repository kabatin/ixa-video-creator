import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  ImageGenerationJob as ImageGenerationJobSchema,
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  imageJobViolation,
  newId,
  type ImageGenerationJob,
  type ImageGenerationJobError,
  type ImageGenerationJobId,
  type MediaAssetId,
  type ModelId,
  type ProjectId,
  type ProviderId,
  type ShotId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { imageGenerationJobs } from '../schema/image-job.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ImageJobRow = typeof imageGenerationJobs.$inferSelect

/** 絵コンテの画像を作るジョブの読み書き（ADR-0029）。戻り値は必ず `@ixa/domain` の型。 */
export type ImageJobRepository = {
  create(input: {
    readonly projectId: ProjectId
    readonly shotId: ShotId
    readonly providerId: ProviderId
    readonly modelId: ModelId
  }): Promise<ImageGenerationJob>
  findById(id: ImageGenerationJobId): Promise<ImageGenerationJob | null>
  /** その Shot で待っている・動いているジョブ（同じ Shot に重ねて回さないため）。 */
  findActiveByShot(shotId: ShotId): Promise<ImageGenerationJob | null>
  /** その Shot の最後のジョブ（状態と失敗の理由を画面に出すため）。 */
  findLatestByShot(shotId: ShotId): Promise<ImageGenerationJob | null>
  /** Project の中で待っている・動いているジョブ。 */
  findActiveByProject(projectId: ProjectId): Promise<ImageGenerationJob[]>
  markRunning(id: ImageGenerationJobId, referenceAssetIds: readonly MediaAssetId[]): Promise<ImageGenerationJob>
  markSucceeded(
    id: ImageGenerationJobId,
    mediaAssetId: MediaAssetId,
    providerRecord: Record<string, unknown>,
  ): Promise<ImageGenerationJob>
  markFailed(
    id: ImageGenerationJobId,
    error: ImageGenerationJobError,
    providerRecord: Record<string, unknown> | null,
  ): Promise<ImageGenerationJob>
}

/**
 * row → Domain。zod で検証し、状態と中身の食い違いも止める（`imageJobViolation`）。
 * **黙って読み替えない。** 成功なのに絵が無い行を「絵なし」に畳むと、どこで落ちたか追えなくなる。
 */
export const imageJobRowToDomain = (row: ImageJobRow): ImageGenerationJob => {
  const job = ImageGenerationJobSchema.parse(row)
  const violation = imageJobViolation(job)
  if (violation !== null) throw new Error(`絵コンテの画像ジョブ ${row.id} の記録が壊れています: ${violation}`)
  return job
}

const ACTIVE = inArray(imageGenerationJobs.status, ['queued', 'running'])

const first = async (rows: Promise<ImageJobRow[]>): Promise<ImageGenerationJob | null> => {
  const row = (await rows)[0]
  return row === undefined ? null : imageJobRowToDomain(row)
}

export const createImageJobRepository = (db: DbClient): ImageJobRepository => {
  /** 状態を 1 つ進める。書く前に食い違いを確かめる（読み直しと同じ規則）。 */
  const transition = async (
    id: ImageGenerationJobId,
    patch: Partial<typeof imageGenerationJobs.$inferInsert>,
  ): Promise<ImageGenerationJob> => {
    const rows = await db.update(imageGenerationJobs).set(patch).where(eq(imageGenerationJobs.id, id)).returning()
    const row = rows[0]
    if (row === undefined) throw new DbNotFoundError('image_generation_jobs', id)
    return imageJobRowToDomain(row)
  }

  return {
    async create(input) {
      const rows = await db
        .insert(imageGenerationJobs)
        .values({ ...input, id: newId(ImageGenerationJobIdSchema), status: 'queued', queuedAt: new Date() })
        .returning()
      const row = rows[0]
      if (row === undefined) throw new Error('絵コンテの画像ジョブを作れませんでした')
      return imageJobRowToDomain(row)
    },

    findById: (id) => first(db.select().from(imageGenerationJobs).where(eq(imageGenerationJobs.id, id))),

    findActiveByShot: (shotId) =>
      first(
        db
          .select()
          .from(imageGenerationJobs)
          .where(and(eq(imageGenerationJobs.shotId, shotId), ACTIVE))
          .orderBy(desc(imageGenerationJobs.id))
          .limit(1),
      ),

    findLatestByShot: (shotId) =>
      first(
        db
          .select()
          .from(imageGenerationJobs)
          .where(eq(imageGenerationJobs.shotId, shotId))
          .orderBy(desc(imageGenerationJobs.id))
          .limit(1),
      ),

    async findActiveByProject(projectId) {
      const rows = await db
        .select()
        .from(imageGenerationJobs)
        .where(and(eq(imageGenerationJobs.projectId, projectId), ACTIVE))
        .orderBy(desc(imageGenerationJobs.id))
      return rows.map(imageJobRowToDomain)
    },

    markRunning: (id, referenceAssetIds) =>
      transition(id, { status: 'running', referenceAssetIds: [...referenceAssetIds], startedAt: new Date() }),

    markSucceeded: (id, mediaAssetId, providerRecord) =>
      transition(id, { status: 'succeeded', mediaAssetId, providerRecord, finishedAt: new Date() }),

    markFailed: (id, error, providerRecord) =>
      transition(id, { status: 'failed', error, providerRecord, finishedAt: new Date() }),
  }
}
