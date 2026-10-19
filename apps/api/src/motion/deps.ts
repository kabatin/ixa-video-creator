import type { ShotRepository, TakeMotionAnalysisRepository, TakeRepository } from '@ixa/db'
import type { MediaAsset, MediaAssetId, TakeId } from '@ixa/domain'

/** 動きの分析のキューの名前（ADR-0054）。worker の `QUEUE_NAMES.motion` と揃える。 */
export const MOTION_QUEUE_NAME = 'motion'

/** キューの上での状態。積んでいなければ（終わった・まだ）null。 */
export type MotionQueueState = 'queued' | 'running'

export type MotionQueue = {
  /** Take を分析に積む。同じ Take が待っている・動いている間は積み増さない。 */
  readonly enqueue: (takeId: TakeId) => Promise<void>
  readonly stateOf: (takeId: TakeId) => Promise<MotionQueueState | null>
}

/** 動きの分析（ADR-0054）の API が使うもの。 */
export type MotionAnalysisDeps = {
  readonly takes: Pick<TakeRepository, 'findById'>
  readonly shots: Pick<ShotRepository, 'findById' | 'findByProject'>
  /** Take の長さ（プレビュー・書き出しと同じ probe の値）を読む。 */
  readonly mediaAssets: { readonly findById: (id: MediaAssetId) => Promise<Pick<MediaAsset, 'probe'> | null> }
  readonly analyses: Pick<TakeMotionAnalysisRepository, 'findLatestByTake' | 'findLatestSucceededByTakes'>
  readonly queue: MotionQueue
}
