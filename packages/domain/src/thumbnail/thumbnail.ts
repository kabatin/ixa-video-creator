import { z } from 'zod'
import { MediaAssetId, ProjectId, ThumbnailId } from '../common/ids.js'
import { TimelineDocument } from '../timeline/timeline.js'
import { ThumbnailSpec } from './thumbnail-spec.js'

/**
 * サムネイルの書き出し 1 回の記録（ADR-0051）。**追記のみ。** 押すたびに 1 行足し、前の行は残す。
 * 更新するのは状態の遷移（queued → rendering → done | failed）と、そのとき決まる列だけ。
 *
 * **署名付き URL を持たない**（規約 7）。背景がタイムラインのコマなら `spec` には秒だけがあり、
 * 描くための TimelineDocument はジョブの中身で渡す（`ThumbnailJobData`）。
 */

export const ThumbnailStatus = z.enum(['queued', 'rendering', 'done', 'failed'])
export type ThumbnailStatus = z.infer<typeof ThumbnailStatus>

export const Thumbnail = z.object({
  id: ThumbnailId,
  projectId: ProjectId,
  spec: ThumbnailSpec,
  status: ThumbnailStatus,
  /** できた JPEG。終わったときだけ。 */
  outputAssetId: MediaAssetId.nullable(),
  /** 書き出しフォルダに置く名前（頼んだときに決める）。`thumbnailExportFileName` が正。 */
  fileName: z.string().min(1),
  /** 失敗の理由（利用者にそのまま見せる文）。失敗したときだけ。 */
  error: z.string().min(1).nullable(),
  createdAt: z.date(),
  finishedAt: z.date().nullable(),
})
export type Thumbnail = z.infer<typeof Thumbnail>

/**
 * 状態と中身が食い違っていないか。破れていれば理由、成り立っていれば null。
 * **規則はここ 1 箇所。** 書く側（リポジトリ）も読み直す側もこれを呼ぶ（lessons L-016）。
 */
export const thumbnailViolation = (
  thumbnail: Pick<Thumbnail, 'status' | 'outputAssetId' | 'error'>,
): string | null => {
  if (thumbnail.status === 'done' && thumbnail.outputAssetId === null) return '終わったのに JPEG がありません'
  if (thumbnail.status === 'failed' && thumbnail.error === null) return '失敗したのに理由がありません'
  if (thumbnail.status !== 'done' && thumbnail.outputAssetId !== null) return 'まだ終わっていないのに JPEG があります'
  if (thumbnail.status !== 'failed' && thumbnail.error !== null) return '失敗していないのに理由があります'
  return null
}

/**
 * thumbnail キューのジョブの中身（API が積み、worker が読む）。
 *
 * 背景がタイムラインのコマなら、API が書き出しと同じ口（`loadTimelineDocument`）で組んだ文書を載せる。
 * 文書の中の URL は署名付きなので **DB に書かずジョブの中身（Redis）でだけ運ぶ**（ADR-0051）。
 * 背景が画像なら null（worker が描く直前に URL を発行する）。
 */
export const ThumbnailJobData = z.object({
  thumbnailId: ThumbnailId,
  timeline: TimelineDocument.nullable(),
})
export type ThumbnailJobData = z.infer<typeof ThumbnailJobData>
