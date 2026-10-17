import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  Thumbnail as ThumbnailSchema,
  ThumbnailSpec as ThumbnailSpecSchema,
  thumbnailViolation,
  type MediaAssetId,
  type ProjectId,
  type Thumbnail,
  type ThumbnailId,
  type ThumbnailStatus,
  type ThumbnailSpecInput,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { thumbnails } from '../schema/thumbnail.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ThumbnailRow = typeof thumbnails.$inferSelect

export type CreateThumbnailInput = {
  /**
   * 呼び出し側が採番する（DOMAIN.md「ID は呼び出し側が採番してよい」）。
   * ファイル名に ID の一部を入れて、同じ秒に頼んだ 2 枚を別の名前にするため。
   */
  readonly id: ThumbnailId
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
  /**
   * 新しい順。**壊れた行は飛ばす**（`onBrokenRow` で知らせる）。1 行のために一覧と、
   * それを読む書き出しフォルダの同期（動画も入る）を丸ごと落とさない。
   */
  findByProject(projectId: ProjectId): Promise<Thumbnail[]>
  /**
   * 状態を進める。**進められる元の状態からだけ書く**（待ち → 描いている → 終わり・失敗）。
   * 終わった行は上書きしない（遅れて来た worker が failed を done に、done を failed にしない）。
   * 書けなかったときは、いまの行をそのまま返す（呼び出し側が status を見て手を引く）。
   */
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

/** どの状態から進めてよいか。終わった行（done / failed）からはどこへも進めない。 */
const FROM: Readonly<Record<'rendering' | 'done' | 'failed', readonly ThumbnailStatus[]>> = {
  // 描いている途中で worker が落ちて積み直されたら、もう一度 rendering から始める。
  rendering: ['queued', 'rendering'],
  done: ['queued', 'rendering'],
  failed: ['queued', 'rendering'],
}

export type ThumbnailRepositoryOptions = {
  /** 一覧で飛ばした壊れた行を知らせる口（ログに残すため）。 */
  readonly onBrokenRow?: (id: string, reason: string) => void
}

export const createThumbnailRepository = (
  db: DbClient,
  options: ThumbnailRepositoryOptions = {},
): ThumbnailRepository => {
  const findById = async (id: ThumbnailId): Promise<Thumbnail | null> => {
    const rows = await db.select().from(thumbnails).where(eq(thumbnails.id, id)).limit(1)
    const row = rows[0]
    return row === undefined ? null : thumbnailRowToDomain(row)
  }

  const transition = async (
    id: ThumbnailId,
    patch: Pick<Thumbnail, 'status' | 'outputAssetId' | 'error' | 'finishedAt'> & { status: keyof typeof FROM },
  ): Promise<Thumbnail> => {
    assertTransition(patch)
    const rows = await db
      .update(thumbnails)
      .set(patch)
      .where(and(eq(thumbnails.id, id), inArray(thumbnails.status, [...FROM[patch.status]])))
      .returning()
    const row = rows[0]
    if (row !== undefined) return thumbnailRowToDomain(row)
    const current = await findById(id)
    if (current === null) throw new DbNotFoundError('thumbnails', id)
    return current
  }

  const toDomainOrSkip = (row: ThumbnailRow): Thumbnail[] => {
    try {
      return [thumbnailRowToDomain(row)]
    } catch (error) {
      options.onBrokenRow?.(row.id, error instanceof Error ? error.message : String(error))
      return []
    }
  }

  return {
    async create(input) {
      const spec = ThumbnailSpecSchema.parse(input.spec)
      const rows = await db
        .insert(thumbnails)
        .values({
          id: input.id,
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

    findById,

    async findByProject(projectId) {
      const rows = await db
        .select()
        .from(thumbnails)
        .where(eq(thumbnails.projectId, projectId))
        .orderBy(desc(thumbnails.id))
      return rows.flatMap(toDomainOrSkip)
    },

    markRendering: (id) => transition(id, { status: 'rendering', outputAssetId: null, error: null, finishedAt: null }),

    markDone: (id, outputAssetId) =>
      transition(id, { status: 'done', outputAssetId, error: null, finishedAt: new Date() }),

    markFailed: (id, error) => transition(id, { status: 'failed', outputAssetId: null, error, finishedAt: new Date() }),
  }
}
