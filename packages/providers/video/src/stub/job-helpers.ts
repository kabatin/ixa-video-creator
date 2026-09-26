import {
  ProviderError,
  type ProviderJobStatus,
  type VideoModelDescriptor,
} from '@ixa/provider-core'
import type { ProviderId } from '@ixa/domain'

/**
 * 手元で描画する Provider（スタブ・ローカルの画像→動画）が共通で使う小物。
 * どちらも「投入 → 裏で ffmpeg → ポーリングで結果を取る」を同じ形で持つ。
 */

export const CANCELLED: ProviderJobStatus = {
  state: 'failed',
  error: { code: 'cancelled', message: 'ジョブはキャンセルされました', retryable: false },
}

export const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    // 既に中断済みなら abort イベントはもう飛ばない。ここで弾かないと待ち続けてしまう。
    if (signal.aborted) {
      reject(new Error('待機前に中断されました', { cause: signal.reason }))
      return
    }

    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('待機中に中断されました', { cause: signal.reason }))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 記録が見つからないときに利用者へ見せる文。**内部の参照（UUID）を入れない。**
 *
 * 見せても利用者に打つ手は増えず、CLAUDE.md の「画面に出さない: 内部 ID」に反する。
 * ここは Provider の失敗理由がそのまま画面の通知へ流れる経路なので、
 * 実装の言葉（ジョブ・poll・provider）も使わない。
 */
const UNKNOWN_JOB_MESSAGE =
  'この生成の記録が見つかりませんでした。結果は残っていないので、もう一度生成してください。'

/** 参照と、読めなかった理由は `cause` に残す。ログでは追えるようにする。 */
export const unknownJobError = (providerId: ProviderId, ref: string, cause?: unknown): ProviderError =>
  new ProviderError(UNKNOWN_JOB_MESSAGE, providerId, false, {
    cause: new Error(`ジョブ参照 ${ref} の記録が見つかりません`, { cause }),
  })

export const failedStatus = (code: string, message: string, retryable: boolean): ProviderJobStatus => ({
  state: 'failed',
  error: { code, message, retryable },
})

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** ジョブ参照（UUID）から決定的に seed を作る。同じジョブなら常に同じ値。 */
export const hashToSeed = (ref: string): number => {
  let hash = 0
  for (const char of ref) hash = (hash * 31 + char.charCodeAt(0)) % 2_147_483_647
  return hash
}

export const resolveModel = (
  providerId: ProviderId,
  models: readonly VideoModelDescriptor[],
  model: VideoModelDescriptor,
): VideoModelDescriptor => {
  const known = models.find((candidate) => candidate.id === model.id)
  if (known === undefined) {
    throw new ProviderError(
      `この Provider は未知のモデル ${model.id} を扱えません`,
      providerId,
      false,
    )
  }
  return known
}
