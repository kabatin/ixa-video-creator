/**
 * Provider が満杯で投入を断ったときの待ち方（ADR-0031）。
 *
 * 手元の生成サーバ（vpipe-api）は 1 本ずつしか作れず、走っている 1 本と待ちの枠が埋まると
 * 投入を断る（`ProviderBusyError`）。まとめて頼んだ生成をそこで失敗にすると 2 本目以降が
 * 全部落ちるので、**ジョブを queued のまま、時間を置いて投入し直す。**
 *
 * - 問い合わせの回数（`attempt`）は増やさない。問い合わせの上限（約 2 時間）は投入後の
 *   待ちのためのもので、投入前の順番待ちに食わせると、長い列の後ろほど走る前に尽きる
 * - 送ったのに応答が失われた投入も同じ形で届く。GenerationJob の ID を冪等キーにしているので、
 *   投げ直しても Provider は同じジョブを返す（二重に生成しない）
 * - 断られた順に並び直すわけではない（予約の順に投げ直す）。**頼んだ順に仕上がるとは限らず、
 *   理屈の上では 1 本が期限まで取り残されうる**
 * - その代わり、ジョブを積んでから `SUBMIT_BUSY_DEADLINE_MS` を過ぎたら諦める。
 *   1 本 7〜25 分で 1 本ずつなので、12 時間あれば 30 本前後の列でも捌ける。
 *   それを超えて空かないのはサーバが詰まっているとみなす（黙って永遠に待たせない）
 */

/**
 * 待つ長さの下限・上限・既定。サーバの `Retry-After` はこの範囲に収める。
 * 上限を 10 分まで取るのは、走っている 1 本が 7〜25 分かかるため。サーバが長めに待てと
 * 言うならそれに従い、空かない枠を叩き続けない。
 */
export const SUBMIT_BUSY_MIN_DELAY_MS = 30_000
export const SUBMIT_BUSY_MAX_DELAY_MS = 600_000
export const SUBMIT_BUSY_DEFAULT_DELAY_MS = 60_000

/** ジョブを積んでからこれを過ぎても投入できなければ諦める。 */
export const SUBMIT_BUSY_DEADLINE_MS = 12 * 60 * 60 * 1000

/**
 * 次に投入を試すまでの待ち。示されなければ既定。
 * 短すぎる値（0 秒など）でサーバを叩き続けず、長すぎる値で空いた枠を遊ばせない。
 */
export const submitBusyDelayMs = (retryAfterMs: number | null): number => {
  if (retryAfterMs === null || !Number.isFinite(retryAfterMs)) return SUBMIT_BUSY_DEFAULT_DELAY_MS
  return Math.min(SUBMIT_BUSY_MAX_DELAY_MS, Math.max(SUBMIT_BUSY_MIN_DELAY_MS, retryAfterMs))
}

/** 積んでからの待ちが期限を過ぎたか。 */
export const submitBusyExpired = (queuedAt: Date, now: Date): boolean =>
  now.getTime() - queuedAt.getTime() > SUBMIT_BUSY_DEADLINE_MS

const HOUR_MS = 60 * 60 * 1000

/** 期限切れで諦めたときの文。**画面に出るので実装の言葉を入れない。** 時間は期限の定数から作る。 */
export const SUBMIT_BUSY_TIMEOUT_MESSAGE = `動画を作る順番が ${String(
  SUBMIT_BUSY_DEADLINE_MS / HOUR_MS,
)} 時間たっても回ってこなかったため、この生成を取りやめました。空いてからもう一度生成してください。`
