/**
 * 秒の表示を 1 箇所に集める。
 *
 * **画面ごとに桁数を決めない。** 以前は `3.75s` / `0:03.75` / `40.031s` /
 * `0.0–6.5s` の 4 通りが混在し、同じ値が画面によって違って見えた。
 *
 * 使い分けの規則はこれだけ。
 * - タイムライン上の位置は時計形式（`0:03.75`）。曲のどこかが読み取れる
 * - 尺は秒（`3.75s`）。時計形式だと長さに見えない
 * - 桁は 2 桁に固定。フレーム単位（30fps で 0.033s）より細かい差は編集で意味を持たない
 */
export const TIME_DECIMALS = 2

/** `0:03.75`。タイムライン上の位置に使う。 */
export const formatClock = (sec: number): string => {
  const safe = Number.isFinite(sec) ? Math.max(sec, 0) : 0
  const minutes = Math.floor(safe / 60)
  const seconds = safe - minutes * 60
  return `${String(minutes)}:${seconds.toFixed(TIME_DECIMALS).padStart(TIME_DECIMALS + 3, '0')}`
}

/** `3.75s`。長さに使う。 */
export const formatDuration = (sec: number): string =>
  `${(Number.isFinite(sec) ? sec : 0).toFixed(TIME_DECIMALS)}s`

/** `0:03.75 – 0:07.50（3.75s）`。区間に使う。 */
export const formatSpan = (startSec: number, durationSec: number): string =>
  `${formatClock(startSec)} – ${formatClock(startSec + durationSec)}（${formatDuration(durationSec)}）`
