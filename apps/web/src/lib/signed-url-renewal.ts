/**
 * 署名付き URL を「いつ取り直すか」の決め事（2026-10-18「ワークベンチを開いたままだと素材が読めなくなる」）。
 *
 * **React もタイマーも出てこない純粋な部分。** フックと部品はここを呼ぶだけにする。
 * 取り直しの時刻と、失敗したときに取り直してよいかは、間違えても画面が静かに壊れる種類の規則で、
 * 部品ごとに書くと必ずズレる（`take-card.tsx` と `media-image.tsx` に 0.8 が 2 度書かれていた）。
 *
 * 実際に起きていたこと: API のログに「素材の URL を受け取れませんでした reason: expired」が 127 件。
 * 開いたときに 1 回だけ取った URL を、5 分を過ぎても使い続けていた。
 */

/** 有効期間のどこで取り直すか。切れてから慌てると絵や音が途切れる。 */
export const RENEW_AT_RATIO = 0.8

/** 取り直しの間隔の下限。期限が極端に短くても叩き続けないための床。 */
export const MIN_RENEW_DELAY_MS = 10_000

/**
 * 取り直すまでの待ち時間（ミリ秒）。
 *
 * 実際の期限は頼んだ秒数より短くはならない（`packages/storage/src/signing-window.ts` は窓の分だけ延ばす）。
 * だから頼んだ秒数の 8 割で取り直せば、切れる前に必ず間に合う。
 */
export const renewDelayMs = (lifetimeSec: number): number => {
  const lifetime = Number.isFinite(lifetimeSec) && lifetimeSec > 0 ? lifetimeSec : 0
  return Math.max(lifetime * RENEW_AT_RATIO * 1_000, MIN_RENEW_DELAY_MS)
}

/**
 * 読めなかったときに取り直してよいのは、いまの URL を取ってからこれだけ経ったあと。
 *
 * **取ったばかりの URL で読めないなら、期限ではなく素材そのものが無い。** 取り直しても直らず、
 * 403 と取り直しを回り続ける。期限はこれより十分長い（最短の 300 秒の 5 分の 1）。
 */
export const RENEW_AFTER_ERROR_MIN_AGE_MS = 60_000

/**
 * 読めなかったときに取り直すか。`obtainedAtMs` はいまの URL を取れた時刻。
 * **取り直している最中は null を渡す**（同じ失敗が何本も続けて来ても 1 回しか頼まない）。
 */
export const mayRenewAfterError = (obtainedAtMs: number | null, nowMs: number): boolean =>
  obtainedAtMs !== null && nowMs - obtainedAtMs >= RENEW_AFTER_ERROR_MIN_AGE_MS

/**
 * Shot のサムネイル一覧（`GET /projects/{id}/shot-posters`）の URL の有効期間（秒）。
 *
 * **API の `DEFAULT_SIGNED_URL_EXPIRES_SEC`（`apps/api/src/routes/media.ts`）の書き写し。**
 * 一覧の応答は期限を返さない（返す形にすると Shot の行すべてに同じ数字が載る）。
 * ズレたら `signed-url-lifetimes.test.ts` が落ちる。
 */
export const POSTER_URL_LIFETIME_SEC = 300

/**
 * タイムラインと Take 比較の材料（TimelineDocument）に入る URL の有効期間（秒）。
 * **API の `TIMELINE_SIGNED_URL_EXPIRES_SEC`（`apps/api/src/routes/timeline.ts`）の書き写し。**
 * ズレたら `signed-url-lifetimes.test.ts` が落ちる。
 */
export const TIMELINE_URL_LIFETIME_SEC = 3600
