import type { MediaAssetRepository, ProjectRepository, SfxJobRepository, TimelineClipRepository } from '@ixa/db'
import type { MediaAssetId, ProjectEventPublisher, SfxJobError, SfxJobId } from '@ixa/domain'
import type { SfxModelDescriptor, SfxProvider } from '@ixa/provider-core'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { LocalGpuLease } from '../generation/local-gpu-lease.js'
import type { SfxJobData } from './job-data.js'

/** 作れる口 1 つ。ジョブに記されたモデル（`model`）で選ぶ。 */
export type SfxAdapter = { readonly provider: SfxProvider; readonly model: SfxModelDescriptor }

/** 効果音を作る（ADR-0052）worker が使うもの。 */
export type SfxProcessorDeps = {
  readonly sfxJobs: SfxJobRepository
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findByChecksum' | 'create'>
  /** 1 本目を効果音の段に置く。 */
  readonly timelineClips: Pick<TimelineClipRepository, 'findByProject' | 'create'>
  readonly storage: ObjectStorage
  /** この環境で作れる口。**ジョブに記されたモデルで作る**（どれで作るかは API が「使う AI」から決める）。 */
  readonly adapters: readonly SfxAdapter[]
  /** 手元の GPU の順番（整理券）。**省略できない形にする**（配線し忘れると動画と同時に GPU を使う）。 */
  readonly localGpuLease: LocalGpuLease
  /** 順番が来ていない・生成先が混んでいるジョブを、時間を置いて積み直す口。 */
  readonly scheduler: { readonly reschedule: (data: SfxJobData, delayMs: number) => Promise<void> }
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly logger: Logger
  readonly now?: () => Date
  /** 借りを延ばす間隔。テストで短くするための差し込み口（既定 1 分）。 */
  readonly gpuRenewIntervalMs?: number
  /** 出来上がりを見に行く間隔。既定 1 秒（10 秒の音で約 1 秒）。 */
  readonly pollIntervalMs?: number
  /** 走り出してから（生成先の順番待ちは数えない）これを過ぎても仕上がらなければ諦める。既定はモデルの `maxWaitSec`（Stable Audio 5 分・MOSS 90 分）。 */
  readonly maxWaitMs?: number
  /** 生成先で順番を待つ（queued）のを、これを過ぎたら諦める。既定は `SFX_MAX_QUEUED_MS`。 */
  readonly maxQueuedMs?: number
}

/** 理由を書いて終える失敗。`record` は調べるための記録（あれば残す）。 */
export class SfxJobFailure extends Error {
  constructor(readonly failure: SfxJobError, readonly record: Record<string, unknown> | null = null) {
    super(failure.message)
  }
}

/** 人が止めた。失敗ではない。 */
export class SfxJobCancelled extends Error {
  constructor(readonly sfxJobId: SfxJobId) {
    super(`効果音のジョブ ${sfxJobId} は止められました`)
  }
}
