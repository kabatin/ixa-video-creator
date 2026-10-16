import type { ImageGenerationJob } from '@ixa/domain'
import type { Logger } from 'pino'
import {
  LOCAL_GPU_HEAD_RETRY_AFTER_MS,
  LOCAL_GPU_RETRY_AFTER_MS,
  type LocalGpuLease,
  type LocalGpuLeaseResult,
} from '../generation/local-gpu-lease.js'
import { ImageJobCancelled, ImageJobFailure } from './steps.js'

/**
 * 手元の GPU を使う絵（ADR-0047。klein-api）を、動画・高画質化と**同じ整理券**に並ばせる。
 *
 * - 券の番号は `queuedAt`（動画と同じ。積んだ順に渡す）
 * - **順番が来ていなければ、その場で待たずに予約し直す**（動画・高画質化と同じ形）。
 *   待つ間 worker の処理枠を握ると、GPU を使わない Codex の絵まで止まり、停止も遅れる。
 *   ジョブは queued のまま（作り始めの印は付けない）
 * - 借りている間は 1 分おきに延ばす（期限は 5 分）。終わったら、失敗・取り消しでも必ず返す
 * - `IMAGE_GPU_WAIT_DEADLINE_MS` を過ぎても順番が来なければ理由を言ってやめる
 */

/** 積んでからこれを過ぎても順番が来なければやめる。絵は 1 枚 30 秒前後で、それより長いのは動画の列の後ろにいるとき。 */
export const IMAGE_GPU_WAIT_DEADLINE_MS = 2 * 60 * 60 * 1000
/** 借りを延ばす間隔。期限（5 分）より十分短く。 */
export const IMAGE_GPU_RENEW_INTERVAL_MS = 60_000

const HOUR_MS = 60 * 60 * 1000

/** 画面に出る文。実装の言葉を入れない。 */
export const IMAGE_GPU_TIMEOUT_MESSAGE = `この Mac の GPU の順番が ${String(
  IMAGE_GPU_WAIT_DEADLINE_MS / HOUR_MS,
)} 時間たっても回ってこなかったため、絵を作るのをやめました。動画が空いてからもう一度作ってください。`

const LEASE_UNAVAILABLE_MESSAGE = 'この Mac の GPU の順番を確かめられませんでした。少し待ってからもう一度作ってください。'

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

/** 返す。**ここで投げない**（返せなくても期限が来れば空く。結果は変えずにログに残す）。 */
const release = async (deps: ImageGpuDeps, job: ImageGenerationJob): Promise<void> => {
  try {
    await deps.localGpuLease.release(job.id)
  } catch (error) {
    deps.logger.warn({ imageJobId: job.id, err: error }, 'この機械の GPU の順番を返せませんでした。期限が切れるまで次が待たされます')
  }
}

/**
 * 順番を取りに行く（待たない）。取れなければ待つ長さを返す。
 * 止められていたら・期限を過ぎていたら、券を返してから投げる（券を残すと後ろが待たされる）。
 */
export const takeLocalGpuTurn = async (deps: ImageGpuDeps, job: ImageGenerationJob): Promise<LocalGpuTurn> => {
  const lease = await (async (): Promise<LocalGpuLeaseResult> => {
    try {
      return await deps.localGpuLease.acquire(job.id, job.queuedAt.getTime())
    } catch (error) {
      // Redis の文を画面へ出さない。理由はログに残す。
      deps.logger.error({ imageJobId: job.id, err: error }, 'この機械の GPU の順番を確かめられませんでした')
      throw new ImageJobFailure({ code: 'local_gpu_unavailable', message: LEASE_UNAVAILABLE_MESSAGE, retryable: true })
    }
  })()
  if (lease.state === 'acquired') return { state: 'acquired' }

  const current = await deps.imageJobs.findById(job.id)
  if (current?.status === 'cancelled') {
    await release(deps, job)
    throw new ImageJobCancelled(job.id)
  }
  const now = deps.now ?? (() => new Date())
  if (now().getTime() - job.queuedAt.getTime() > IMAGE_GPU_WAIT_DEADLINE_MS) {
    await release(deps, job)
    throw new ImageJobFailure({ code: 'local_gpu_timeout', message: IMAGE_GPU_TIMEOUT_MESSAGE, retryable: true })
  }
  return { state: 'wait', delayMs: lease.ahead === 0 ? LOCAL_GPU_HEAD_RETRY_AFTER_MS : LOCAL_GPU_RETRY_AFTER_MS }
}

/** 順番を持ったまま `run` を走らせ、終わったら（投げても）返す。借りている間は延ばし続ける。 */
export const holdLocalGpu = async <T>(deps: ImageGpuDeps, job: ImageGenerationJob, run: () => Promise<T>): Promise<T> => {
  const timer = setInterval(() => {
    deps.localGpuLease
      .renew(job.id)
      .then((lease) => {
        if (lease.state === 'held') {
          deps.logger.warn({ imageJobId: job.id, heldBy: lease.by }, 'この機械の GPU の順番が別の仕事に移っていました。同時に走っている可能性があります')
        }
      })
      .catch((error: unknown) => {
        deps.logger.warn({ imageJobId: job.id, err: error }, 'この機械の GPU の順番を延ばせませんでした')
      })
  }, deps.gpuRenewIntervalMs ?? IMAGE_GPU_RENEW_INTERVAL_MS)
  try {
    return await run()
  } finally {
    clearInterval(timer)
    await release(deps, job)
  }
}
