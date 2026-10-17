import { desc, eq } from 'drizzle-orm'
import {
  Thumbnail as ThumbnailSchema,
  ThumbnailId as ThumbnailIdSchema,
  ThumbnailSpec as ThumbnailSpecSchema,
  newId,
  thumbnailViolation,
  type MediaAssetId,
  type ProjectId,
  type Thumbnail,
  type ThumbnailId,
  type ThumbnailSpecInput,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { thumbnails } from '../schema/thumbnail.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ThumbnailRow = typeof thumbnails.$inferSelect

export type CreateThumbnailInput = {
  readonly projectId: ProjectId
  /** 書き込む前にもう一度 `ThumbnailSpec` を通す（呼び出し側の検証に頼らない）。 */
  readonly spec: ThumbnailSpecInput
  readonly fileName: string
  /** 頼んだ日時。ファイル名の日時と揃えるため、呼び出し側が決めて渡す。 */
  readonly createdAt: Date
}

/**
 * サムネイルの書き出しの読み書き（ADR-0051）。戻り値は必ず `@ixa/domain` の型。
 * **追記のみ。** 仕様・名前を差し替える口は持たない（何を書き出したかが信用できなくなる）。
 */
export type ThumbnailRepository = {
  create(input: CreateThumbnailInput): Promise<Thumbnail>
  findById(id: ThumbnailId): Promise<Thumbnail | null>
  /** 新しい順。 */
  findByProject(projectId: ProjectId): Promise<Thumbnail[]>
  markRendering(id: ThumbnailId): Promise<Thumbnail>
  markDone(id: ThumbnailId, outputAssetId: MediaAssetId): Promise<Thumbnail>
  /** `error` は利用者にそのまま見せる文。 */
  markFailed(id: ThumbnailId, error: string): Promise<Thumbnail>
}

/**
 * row → Domain。zod で検証し、状態と中身の食い違いも止める（`thumbnailViolation`）。
 * **黙って読み替えない。** 終わったのに JPEG が無い行を「まだ」に畳むと、どこで落ちたか追えなくなる。
 */
export const thumbnailRowToDomain = (row: ThumbnailRow): Thumbnail => {
  const thumbnail = ThumbnailSchema.parse(row)
  const violation = thumbnailViolation(thumbnail)
  if (violation !== null) throw new Error(`サムネイル ${row.id} の記録が壊れています: ${violation}`)
  return thumbnail
}

/** 書く前に、書いた後の形が規則を破らないかを確かめる（読み直しと同じ規則。L-016）。 */
const assertTransition = (patch: Pick<Thumbnail, 'status' | 'outputAssetId' | 'error'>): void => {
  // 空の理由は「理由なし」と同じ。列の型（1 字以上）も書く前に通す。
  ThumbnailSchema.shape.error.parse(patch.error)
  const violation = thumbnailViolation(patch)
  if (violation !== null) throw new Error(`サムネイルの状態を進められません: ${violation}`)
}

export const createThumbnailRepository = (db: DbClient): ThumbnailRepository => {
  const transition = async (
    id: ThumbnailId,
    patch: Pick<Thumbnail, 'status' | 'outputAssetId' | 'error' | 'finishedAt'>,
  ): Promise<Thumbnail> => {
    assertTransition(patch)
    const rows = await db.update(thumbnails).set(patch).where(eq(thumbnails.id, id)).returning()
    const row = rows[0]
    if (row === undefined) throw new DbNotFoundError('thumbnails', id)
    return thumbnailRowToDomain(row)
  }

  return {
    async create(input) {
      const spec = ThumbnailSpecSchema.parse(input.spec)
      const rows = await db
        .insert(thumbnails)
        .values({
          id: newId(ThumbnailIdSchema),
          projectId: input.projectId,
          spec,
          status: 'queued',
          outputAssetId: null,
          fileName: input.fileName,
          error: null,
          createdAt: input.createdAt,
          finishedAt: null,
        })
        .returning()
      const row = rows[0]
      if (row === undefined) throw new Error('サムネイルの書き出しを記録できませんでした')
      return thumbnailRowToDomain(row)
    },

    async findById(id) {
      const rows = await db.select().from(thumbnails).where(eq(thumbnails.id, id)).limit(1)
      const row = rows[0]
      return row === undefined ? null : thumbnailRowToDomain(row)
    },

    async findByProject(projectId) {
      const rows = await db
        .select()
        .from(thumbnails)
        .where(eq(thumbnails.projectId, projectId))
        .orderBy(desc(thumbnails.id))
      return rows.map(thumbnailRowToDomain)
    },

    markRendering: (id) => transition(id, { status: 'rendering', outputAssetId: null, error: null, finishedAt: null }),

    markDone: (id, outputAssetId) =>
      transition(id, { status: 'done', outputAssetId, error: null, finishedAt: new Date() }),

    markFailed: (id, error) => transition(id, { status: 'failed', outputAssetId: null, error, finishedAt: new Date() }),
  }
}
