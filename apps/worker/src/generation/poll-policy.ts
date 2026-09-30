import type { GenerationJob } from '@ixa/domain'
import type { PollPolicy, ProviderRegistry, VideoProvider } from '@ixa/provider-core'

/**
 * 投入後の問い合わせの間隔と回数（ADR-0030）。
 *
 * 既定は 5 秒から倍々に伸ばして最大 2 分おき・60 回（約 2 時間）。Provider が `pollPolicy` を
 * 持っていればその上限と回数を使う（伸ばし方は同じで、頭打ちの間隔と諦める回数だけが変わる）。
 */

/** ポーリング間隔の初期値と上限。 */
export const POLL_BACKOFF_BASE_MS = 5_000
export const POLL_BACKOFF_MAX_MS = 120_000
/** これを超えたら諦めて failed にする。既定で約 2 時間分。 */
export const MAX_POLL_ATTEMPTS = 60

export const DEFAULT_POLL_POLICY: PollPolicy = Object.freeze({
  maxIntervalMs: POLL_BACKOFF_MAX_MS,
  maxAttempts: MAX_POLL_ATTEMPTS,
})

/** Provider の方針。持っていなければ既定。 */
export const pollPolicyOf = (provider: Pick<VideoProvider, 'pollPolicy'>): PollPolicy =>
  provider.pollPolicy ?? DEFAULT_POLL_POLICY

/**
 * ジョブの行から方針を引く（問い合わせの一時的な失敗の後など、Provider を手元に持っていない場面）。
 * モデルが決まっていない・登録が無いときは既定へ倒す。そのジョブはどのみち別の検査
 * （`model_unresolved` / `unknown_model`）で止まるので、ここで投げて理由を上書きしない。
 */
export const pollPolicyForJob = (registry: ProviderRegistry, job: GenerationJob): PollPolicy => {
  if (job.resolvedModel === null) return DEFAULT_POLL_POLICY
  try {
    return pollPolicyOf(registry.providerFor(job.resolvedModel))
  } catch {
    return DEFAULT_POLL_POLICY
  }
}

/** 指数バックオフ。attempt は 1 始まり。方針の上限で頭打ちにする。 */
export const pollDelayMs = (attempt: number, policy: PollPolicy = DEFAULT_POLL_POLICY): number =>
  Math.min(POLL_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), policy.maxIntervalMs)
