import type { ImageGenerationJob } from '@ixa/domain'
import type { Logger } from 'pino'
import type { LocalGpuLease } from '../generation/local-gpu-lease.js'
import {
  holdLocalGpuTurn,
  LOCAL_GPU_RENEW_INTERVAL_MS,
  releaseLocalGpuTurn,
  requestLocalGpuTurn,
  type LocalGpuTurnJob,
} from '../generation/local-gpu-turn.js'
import { ImageJobCancelled, ImageJobFailure } from './steps.js'

/**
 * 手元の GPU を使う絵（ADR-0047。klein-api）を、動画・高画質化と**同じ整理券**に並ばせる。
 * 並び方は曲と共通（`generation/local-gpu-turn.ts`）。ここは絵の失敗の形と画面の文だけを持つ。
 *
 * - **順番が来ていなければ、その場で待たずに予約し直す**。ジョブは queued のまま（作り始めの印は付けない）
 * - `IMAGE_GPU_WAIT_DEADLINE_MS` を過ぎても順番が来なければ理由を言ってやめる
 */

/** 積んでからこれを過ぎても順番が来なければやめる。絵は 1 枚 30 秒前後で、それより長いのは動画の列の後ろにいるとき。 */
export const IMAGE_GPU_WAIT_DEADLINE_MS = 2 * 60 * 60 * 1000
/** 借りを延ばす間隔。期限（5 分）より十分短く。 */
export const IMAGE_GPU_RENEW_INTERVAL_MS = LOCAL_GPU_RENEW_INTERVAL_MS

const HOUR_MS = 60 * 60 * 1000

/** 画面に出る文。実装の言葉を入れない。 */
export const IMAGE_GPU_TIMEOUT_MESSAGE = `この Mac の GPU の順番が ${String(
  IMAGE_GPU_WAIT_DEADLINE_MS / HOUR_MS,
)} 時間たっても回ってこなかったため、絵を作るのをやめました。動画が空いてからもう一度作ってください。`

export const LOCAL_GPU_UNAVAILABLE_MESSAGE =
  'この Mac の GPU の順番を確かめられませんでした。少し待ってからもう一度作ってください。'

export type ImageGpuDeps = {
  readonly localGpuLease: LocalGpuLease
  readonly imageJobs: { readonly findById: (id: ImageGenerationJob['id']) => Promise<ImageGenerationJob | null> }
  readonly logger: Logger
  readonly now?: () => Date
  /** 延ばす間隔。テストで短くするための差し込み口。 */
  readonly gpuRenewIntervalMs?: number
}

/** 順番を取れたか。取れなければ、次に見に来るまでの待ち。 */
export type LocalGpuTurn = { readonly state: 'acquired' } | { readonly state: 'wait'; readonly delayMs: number }

const turnJob = (job: ImageGenerationJob): LocalGpuTurnJob => ({
  id: job.id,
  queuedAt: job.queuedAt,
  logContext: { imageJobId: job.id },
})

/**
 * 順番を取りに行く（待たない）。取れなければ待つ長さを返す。
 * 止められていたら・期限を過ぎていたら、券を返してから投げる（券を残すと後ろが待たされる）。
 */
export const takeLocalGpuTurn = async (deps: ImageGpuDeps, job: ImageGenerationJob): Promise<LocalGpuTurn> => {
  const outcome = await requestLocalGpuTurn(deps, {
    ...turnJob(job),
    waitDeadlineMs: IMAGE_GPU_WAIT_DEADLINE_MS,
    isCancelled: async () => (await deps.imageJobs.findById(job.id))?.status === 'cancelled',
  })
  switch (outcome.state) {
    case 'acquired':
    case 'wait':
      return outcome
    case 'cancelled':
      throw new ImageJobCancelled(job.id)
    case 'timeout':
      throw new ImageJobFailure({ code: 'local_gpu_timeout', message: IMAGE_GPU_TIMEOUT_MESSAGE, retryable: true })
    case 'unavailable':
      throw new ImageJobFailure({ code: 'local_gpu_unavailable', message: LOCAL_GPU_UNAVAILABLE_MESSAGE, retryable: true })
  }
}

/** 順番を持ったまま `run` を走らせ、終わったら（投げても）返す。借りている間は延ばし続ける。 */
export const holdLocalGpu = <T>(deps: ImageGpuDeps, job: ImageGenerationJob, run: () => Promise<T>): Promise<T> =>
  holdLocalGpuTurn(deps, turnJob(job), run)

/** 順番待ちの間に止められた絵の券を列から外す（自分の券だけ。投げない）。 */
export const releaseCancelledLocalGpuTurn = (deps: ImageGpuDeps, job: ImageGenerationJob): Promise<void> =>
  releaseLocalGpuTurn(deps, turnJob(job))
