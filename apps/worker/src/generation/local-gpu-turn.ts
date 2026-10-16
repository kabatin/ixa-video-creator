import type { Logger } from 'pino'
import {
  LOCAL_GPU_HEAD_RETRY_AFTER_MS,
  LOCAL_GPU_RETRY_AFTER_MS,
  type LocalGpuLease,
  type LocalGpuLeaseResult,
} from './local-gpu-lease.js'

/**
 * 手元の GPU を使う「動画でない」ジョブ（絵 ADR-0047・曲 ADR-0048）を、動画・高画質化と**同じ整理券**に並ばせる。
 *
 * - 券の番号は `queuedAt`（動画と同じ。積んだ順に渡す）
 * - **順番が来ていなければ、その場で待たずに予約し直す**（動画・高画質化と同じ形）。
 *   待つ間 worker の処理枠を握ると、GPU を使わない仕事まで止まり、停止も遅れる
 * - 借りている間は 1 分おきに延ばす（期限は 5 分）。終わったら、失敗・取り消しでも必ず返す
 * - 期限（`waitDeadlineMs`）を過ぎても順番が来なければやめる
 *
 * ジョブの種類ごとの違い（失敗の形・画面の文）は呼ぶ側が持つ。ここは結果の種類だけを返す。
 */

/** 借りを延ばす間隔。期限（5 分）より十分短く。 */
export const LOCAL_GPU_RENEW_INTERVAL_MS = 60_000

export type LocalGpuTurnDeps = {
  readonly localGpuLease: LocalGpuLease
  readonly logger: Logger
  readonly now?: () => Date
  /** 延ばす間隔。テストで短くするための差し込み口。 */
  readonly gpuRenewIntervalMs?: number
}

/** 並ぶジョブ。`logContext` はログに付ける（例: `{ imageJobId }`）。 */
export type LocalGpuTurnJob = {
  readonly id: string
  readonly queuedAt: Date
  readonly logContext: Readonly<Record<string, unknown>>
}

export type LocalGpuTurnRequest = LocalGpuTurnJob & {
  /** 積んでからこれを過ぎても順番が来なければやめる。 */
  readonly waitDeadlineMs: number
  /** 人が止めたか。順番が来ていないときだけ見る。 */
  readonly isCancelled: () => Promise<boolean>
}

/**
 * 順番を取りに行った結果。
 * `cancelled` と `timeout` のときは券をもう返してある。`unavailable` は順番を確かめられなかった（理由はログ）。
 */
export type LocalGpuTurnOutcome =
  | { readonly state: 'acquired' }
  | { readonly state: 'wait'; readonly delayMs: number }
  | { readonly state: 'cancelled' }
  | { readonly state: 'timeout' }
  | { readonly state: 'unavailable' }

/** 返す。**ここで投げない**（返せなくても期限が来れば空く。結果は変えずにログに残す）。 */
const release = async (deps: LocalGpuTurnDeps, job: LocalGpuTurnJob): Promise<void> => {
  try {
    await deps.localGpuLease.release(job.id)
  } catch (error) {
    deps.logger.warn({ ...job.logContext, err: error }, 'この機械の GPU の順番を返せませんでした。期限が切れるまで次が待たされます')
  }
}

/**
 * 順番を取りに行く（待たない）。取れなければ待つ長さを返す。
 * 止められていたら・期限を過ぎていたら、券を返してからそう返す（券を残すと後ろが待たされる）。
 */
export const requestLocalGpuTurn = async (
  deps: LocalGpuTurnDeps,
  request: LocalGpuTurnRequest,
): Promise<LocalGpuTurnOutcome> => {
  const lease = await (async (): Promise<LocalGpuLeaseResult | null> => {
    try {
      return await deps.localGpuLease.acquire(request.id, request.queuedAt.getTime())
    } catch (error) {
      // Redis の文を画面へ出さない。理由はログに残す。
      deps.logger.error({ ...request.logContext, err: error }, 'この機械の GPU の順番を確かめられませんでした')
      return null
    }
  })()
  if (lease === null) return { state: 'unavailable' }
  if (lease.state === 'acquired') return { state: 'acquired' }

  if (await request.isCancelled()) {
    await release(deps, request)
    return { state: 'cancelled' }
  }
  const now = deps.now ?? (() => new Date())
  if (now().getTime() - request.queuedAt.getTime() > request.waitDeadlineMs) {
    await release(deps, request)
    return { state: 'timeout' }
  }
  return { state: 'wait', delayMs: lease.ahead === 0 ? LOCAL_GPU_HEAD_RETRY_AFTER_MS : LOCAL_GPU_RETRY_AFTER_MS }
}

/** 順番を持ったまま `run` を走らせ、終わったら（投げても）返す。借りている間は延ばし続ける。 */
export const holdLocalGpuTurn = async <T>(
  deps: LocalGpuTurnDeps,
  job: LocalGpuTurnJob,
  run: () => Promise<T>,
): Promise<T> => {
  const timer = setInterval(() => {
    deps.localGpuLease
      .renew(job.id)
      .then((lease) => {
        if (lease.state === 'held') {
          deps.logger.warn({ ...job.logContext, heldBy: lease.by }, 'この機械の GPU の順番が別の仕事に移っていました。同時に走っている可能性があります')
        }
      })
      .catch((error: unknown) => {
        deps.logger.warn({ ...job.logContext, err: error }, 'この機械の GPU の順番を延ばせませんでした')
      })
  }, deps.gpuRenewIntervalMs ?? LOCAL_GPU_RENEW_INTERVAL_MS)
  try {
    return await run()
  } finally {
    clearInterval(timer)
    await release(deps, job)
  }
}
