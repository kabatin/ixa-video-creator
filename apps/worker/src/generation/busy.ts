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
 * - **手元の GPU は積んだ順に渡す**（整理券。`local-gpu-lease.ts`）。
 *   2026-10-08 までは早い者勝ちで、起きた瞬間に空いていたジョブが取っていた。
 *   実際に 2 作品を積んだ夜、**先に積んだほうが 5 時間 1 本も進まなかった**
 *   （列の長いほうが抽選に勝ち続ける）。いまは番号の小さい順にしか渡さない
 * - 雲の上の Provider（fal）には列が無い。満杯で断られたら、従来どおり時間を置いて投げ直す
 * - ジョブを積んでから `SUBMIT_BUSY_DEADLINE_MS` を過ぎたら諦める。
 *   1 本 7〜25 分で 1 本ずつなので、12 時間あれば 30 本前後の列でも捌ける。
 *   それを超えて空かないのは**サーバが詰まっている**とみなす（黙って永遠に待たせない）。
 *   整理券にしても期限は残す。順番が来ないまま 12 時間なら、待たせ続けるより理由を出して止める
 */

/**
 * 待つ長さの下限・上限・既定。サーバの `Retry-After` はこの範囲に収める。
 * 上限を 10 分まで取るのは、走っている 1 本が 7〜25 分かかるため。サーバが長めに待てと
 * 言うならそれに従い、空かない枠を叩き続けない。
 */
export const SUBMIT_BUSY_MIN_DELAY_MS = 30_000
/**
 * **自分が列の先頭のとき**の下限（整理券。2026-10-08）。
 *
 * 普段の下限（30 秒）は「満杯の生成先を叩き続けない」ためのもの。
 * 先頭のジョブが見ているのは生成先ではなく**自分の番が来たかどうか**（Redis の鍵 1 つ）なので、
 * 叩く相手が違う。ここを 30 秒のままにすると、GPU が空いてから動き出すまで最大 30 秒遊ぶ。
 */
export const SUBMIT_BUSY_HEAD_MIN_DELAY_MS = 10_000
export const SUBMIT_BUSY_MAX_DELAY_MS = 600_000
export const SUBMIT_BUSY_DEFAULT_DELAY_MS = 60_000

/** ジョブを積んでからこれを過ぎても投入できなければ諦める。 */
export const SUBMIT_BUSY_DEADLINE_MS = 12 * 60 * 60 * 1000

/**
 * 次に投入を試すまでの待ち。示されなければ既定。
 * 短すぎる値（0 秒など）でサーバを叩き続けず、長すぎる値で空いた枠を遊ばせない。
 *
 * `atHead` は**自分が整理券の先頭**のとき。下限だけが変わる（上限と既定は同じ）。
 */
export const submitBusyDelayMs = (
  retryAfterMs: number | null,
  options: { readonly atHead?: boolean } = {},
): number => {
  if (retryAfterMs === null || !Number.isFinite(retryAfterMs)) return SUBMIT_BUSY_DEFAULT_DELAY_MS
  const min = options.atHead === true ? SUBMIT_BUSY_HEAD_MIN_DELAY_MS : SUBMIT_BUSY_MIN_DELAY_MS
  return Math.min(SUBMIT_BUSY_MAX_DELAY_MS, Math.max(min, retryAfterMs))
}

/** 積んでからの待ちが期限を過ぎたか。 */
export const submitBusyExpired = (queuedAt: Date, now: Date): boolean =>
  now.getTime() - queuedAt.getTime() > SUBMIT_BUSY_DEADLINE_MS

const HOUR_MS = 60 * 60 * 1000

/** 期限切れで諦めたときの文。**画面に出るので実装の言葉を入れない。** 時間は期限の定数から作る。 */
export const SUBMIT_BUSY_TIMEOUT_MESSAGE = `動画を作る順番が ${String(
  SUBMIT_BUSY_DEADLINE_MS / HOUR_MS,
)} 時間たっても回ってこなかったため、この生成を取りやめました。空いてからもう一度生成してください。`
