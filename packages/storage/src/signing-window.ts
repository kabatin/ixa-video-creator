/**
 * 署名付き URL の署名の時刻と期限を、**窓の頭に揃える**（制作者 2026-10-02「VIDEO1 の調整をしばらく続けていると、
 * この Shot の素材を読み込めませんとエラーが出たり、ジッターが起きたり」）。
 *
 * 署名をいまの時刻で作ると、同じ物でも頼むたびに URL が変わる。タイムラインは編集のたびに読み直すので、
 * プレビューが 39 本の絵と動画を毎回すべて読み直していた（読み込みの取りやめ・待ちで止まる・失敗）。
 * 窓の中なら同じ URL になり、ブラウザは読み直さない。
 *
 * - 窓は期限の 1/4。頼んだ秒数より早くは切れず、延びるのは窓の分まで
 * - 純粋な関数。いまの時刻は呼び出し側が渡す
 */

/** 窓は期限の何分の 1 か。 */
const WINDOW_DIVISOR = 4

export type SigningWindow = { readonly signingDate: Date; readonly expiresInSec: number }

export const signingWindow = (nowMs: number, expiresInSec: number): SigningWindow => {
  const windowSec = Math.max(1, Math.floor(expiresInSec / WINDOW_DIVISOR))
  const nowSec = Math.floor(nowMs / 1000)
  const startSec = nowSec - (nowSec % windowSec)
  return { signingDate: new Date(startSec * 1000), expiresInSec: expiresInSec + windowSec }
}
