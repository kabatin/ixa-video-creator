import type { MediaAssetRepository, MusicJobRepository, MusicTrackRepository, ProjectRepository } from '@ixa/db'
import type { MediaAssetId, MusicJobError, MusicJobId, MusicTrackId, ProjectEventPublisher } from '@ixa/domain'
import type { MusicModelDescriptor, MusicProvider } from '@ixa/provider-core'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { LocalGpuLease } from '../generation/local-gpu-lease.js'
import type { MusicJobData } from './job-data.js'

/** 作れる口 1 つ。ジョブに記されたモデル（`model`）で選ぶ。 */
export type MusicAdapter = { readonly provider: MusicProvider; readonly model: MusicModelDescriptor }

/** 曲を作る（ADR-0048）worker が使うもの。 */
export type MusicProcessorDeps = {
  readonly musicJobs: MusicJobRepository
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly musicTracks: Pick<MusicTrackRepository, 'findByProject' | 'create'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findByChecksum' | 'create'>
  readonly storage: ObjectStorage
  /** この環境で作れる口。**ジョブに記されたモデルで作る**（どれで作るかは API が「使う AI」から決める）。 */
  readonly adapters: readonly MusicAdapter[]
  /**
   * 手元の GPU の順番（整理券）。`exclusiveResource: 'local-gpu'` を名乗る口だけが並ぶ。
   * **省略できない形にする。** 省略できると、配線し忘れたとき動画と同時に GPU を使い始める。
   */
  readonly localGpuLease: LocalGpuLease
  /** 順番が来ていない・生成先が混んでいるジョブを、時間を置いて積み直す口（待つ間 worker の処理枠を握らない）。 */
  readonly scheduler: { readonly reschedule: (data: MusicJobData, delayMs: number) => Promise<void> }
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  /** できた楽曲を解析に回す（拍・区切り。ほかの楽曲と同じ）。 */
  readonly analysisQueue: { readonly enqueue: (musicTrackId: MusicTrackId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly logger: Logger
  readonly now?: () => Date
  /** 借りを延ばす間隔。テストで短くするための差し込み口（既定 1 分）。 */
  readonly gpuRenewIntervalMs?: number
  /** 出来上がりを見に行く間隔。既定 3 秒。 */
  readonly pollIntervalMs?: number
  /** 投入してからこれを過ぎても仕上がらなければ諦める。既定 60 分。 */
  readonly maxWaitMs?: number
}

/** 理由を書いて終える失敗。`record` は調べるための記録（あれば残す）。 */
export class MusicJobFailure extends Error {
  constructor(readonly failure: MusicJobError, readonly record: Record<string, unknown> | null = null) {
    super(failure.message)
  }
}

/** 人が止めた。失敗ではない。 */
export class MusicJobCancelled extends Error {
  constructor(readonly musicJobId: MusicJobId) {
    super(`曲のジョブ ${musicJobId} は止められました`)
  }
}
