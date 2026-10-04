import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import {
  ImageGenerationJob as ImageGenerationJobSchema,
  ImageGenerationJobId as ImageGenerationJobIdSchema,
  imageJobViolation,
  newId,
  type ImageGenerationJob,
  type ImageGenerationJobError,
  type CharacterId,
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

/** 作るときの入力。持ち主は種類で決まる（最初のフレームは Shot、キャラクターシートはキャラクター。ADR-0035）。 */
export type CreateImageJobInput = {
  readonly projectId: ProjectId
  readonly providerId: ProviderId
  readonly modelId: ModelId
} & (
  | { readonly kind: 'start_frame'; readonly shotId: ShotId }
  | {
      readonly kind: 'character_sheet'
      readonly characterId: CharacterId
      /** 手本の画像。頼んだときに決まる（最初のフレームは実行時に決まるので、ここには無い）。 */
      readonly referenceAssetIds: readonly MediaAssetId[]
    }
)

/** 止める範囲。`shotIds` が無ければ Project の全部。 */
export type ImageJobCancelTarget = {
  readonly projectId: ProjectId
  readonly shotIds?: readonly ShotId[]
}

/** 絵を作るジョブの読み書き（ADR-0029）。戻り値は必ず `@ixa/domain` の型。 */
export type ImageJobRepository = {
  create(input: CreateImageJobInput): Promise<ImageGenerationJob>
  findById(id: ImageGenerationJobId): Promise<ImageGenerationJob | null>
  /** その Shot で待っている・動いているジョブ（同じ Shot に重ねて回さないため）。 */
  findActiveByShot(shotId: ShotId): Promise<ImageGenerationJob | null>
  /** その Shot の最後のジョブ（状態と失敗の理由を画面に出すため）。 */
  findLatestByShot(shotId: ShotId): Promise<ImageGenerationJob | null>
  /** そのキャラクターで待っている・動いているシートのジョブ（重ねて回さないため）。 */
  findActiveByCharacter(characterId: CharacterId): Promise<ImageGenerationJob | null>
  /** そのキャラクターの最後のシートのジョブ（状態と失敗の理由を画面に出すため）。 */
  findLatestByCharacter(characterId: CharacterId): Promise<ImageGenerationJob | null>
  /** Project の中で待っている・動いているジョブ。 */
  findActiveByProject(projectId: ProjectId): Promise<ImageGenerationJob[]>
  /**
   * 待っている・動いているジョブを止める（制作者 2026-10-04）。`shotIds` を渡せばその Shot の絵だけ、
   * 渡さなければ Project の全部（キャラクターシートも）。止めたジョブを返す。
   */
  cancelActive(target: ImageJobCancelTarget): Promise<ImageGenerationJob[]>
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
  if (violation !== null) throw new Error(`絵のジョブ ${row.id} の記録が壊れています: ${violation}`)
  return job
}

const ACTIVE = inArray(imageGenerationJobs.status, ['queued', 'running'])

const first = async (rows: Promise<ImageJobRow[]>): Promise<ImageGenerationJob | null> => {
  const row = (await rows)[0]
  return row === undefined ? null : imageJobRowToDomain(row)
}

export const createImageJobRepository = (db: DbClient): ImageJobRepository => {
  /**
   * 状態を 1 つ進める。書く前に食い違いを確かめる（読み直しと同じ規則）。
   * **止めた行は上書きしない。** そのときは止めた行をそのまま返す（呼び出し側が `cancelled` を見て手を引く）。
   */
  const transition = async (
    id: ImageGenerationJobId,
    patch: Partial<typeof imageGenerationJobs.$inferInsert>,
  ): Promise<ImageGenerationJob> => {
    const rows = await db
      .update(imageGenerationJobs)
      .set(patch)
      .where(and(eq(imageGenerationJobs.id, id), ne(imageGenerationJobs.status, 'cancelled')))
      .returning()
    const row = rows[0]
    if (row !== undefined) return imageJobRowToDomain(row)
    const current = await first(db.select().from(imageGenerationJobs).where(eq(imageGenerationJobs.id, id)))
    if (current === null) throw new DbNotFoundError('image_generation_jobs', id)
    return current
  }

  return {
    async create(input) {
      const owner =
        input.kind === 'start_frame'
          ? { shotId: input.shotId, characterId: null, referenceAssetIds: [] }
          : { shotId: null, characterId: input.characterId, referenceAssetIds: [...input.referenceAssetIds] }
      const rows = await db
        .insert(imageGenerationJobs)
        .values({
          id: newId(ImageGenerationJobIdSchema),
          projectId: input.projectId,
          kind: input.kind,
          ...owner,
          providerId: input.providerId,
          modelId: input.modelId,
          status: 'queued',
          queuedAt: new Date(),
        })
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

    findActiveByCharacter: (characterId) =>
      first(
        db
          .select()
          .from(imageGenerationJobs)
          .where(and(eq(imageGenerationJobs.characterId, characterId), ACTIVE))
          .orderBy(desc(imageGenerationJobs.id))
          .limit(1),
      ),

    findLatestByCharacter: (characterId) =>
      first(
        db
          .select()
          .from(imageGenerationJobs)
          .where(eq(imageGenerationJobs.characterId, characterId))
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

    async cancelActive({ projectId, shotIds }) {
      if (shotIds !== undefined && shotIds.length === 0) return []
      const rows = await db
        .update(imageGenerationJobs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(
          and(
            eq(imageGenerationJobs.projectId, projectId),
            ACTIVE,
            ...(shotIds === undefined ? [] : [inArray(imageGenerationJobs.shotId, [...shotIds])]),
          ),
        )
        .returning()
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
