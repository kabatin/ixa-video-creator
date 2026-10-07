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

/**
 * `0:03.75`。タイムライン上の位置に使う。
 *
 * **先に 1/100 秒へ丸めてから分と秒に割る。** 秒の側だけを `toFixed` すると
 * 59.999 が `0:60.00` になる。
 *
 * **負と NaN は 0 に倒す。** 位置が負になることは無く、そうなっているのは
 * どこかの計算が壊れているとき。画面に `-0:05.00` と出しても読み手は何もできない。
 */
export const formatClock = (sec: number): string => {
  const safe = Number.isFinite(sec) ? Math.max(sec, 0) : 0
  const hundredths = Math.round(safe * 100)
  const minutes = Math.floor(hundredths / 6000)
  const rest = (hundredths - minutes * 6000) / 100
  return `${String(minutes)}:${rest.toFixed(TIME_DECIMALS).padStart(TIME_DECIMALS + 3, '0')}`
}

/** `3.75s`。長さに使う。**時計形式にしない**（長さに見えない）。 */
export const formatDuration = (sec: number): string =>
  `${(Number.isFinite(sec) ? sec : 0).toFixed(TIME_DECIMALS)}s`

/**
 * `1:56.04（116.04s）`。**長い尺**に使う。曲全体のように分をまたぐ長さは、
 * 秒だけだと読み取れない。短い尺には使わない（`formatDuration` で足りる）。
 */
export const formatLongDuration = (sec: number): string =>
  `${formatClock(sec)}（${formatDuration(sec)}）`

/** `0:03.75 – 0:07.50（3.75s）`。区間に使う。 */
export const formatSpan = (startSec: number, durationSec: number): string =>
  `${formatClock(startSec)} – ${formatClock(startSec + durationSec)}（${formatDuration(durationSec)}）`

/**
 * 待っている間の経過（`2:31`）。生成などを待つ間に使う。**秒の小数は出さない**（1 秒ずつ増えれば足りる）。
 * 負と NaN は 0 に倒す（`formatClock` と同じ）。
 */
export const formatElapsed = (sec: number): string => {
  const whole = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * 目安の長さ（`約 45 秒`・`約 4 分`・`約 3 時間 20 分`）。
 * 90 秒未満は秒、90 分未満は分、それ以上は時間と分。
 *
 * **時間に繰り上げるのは、まとめて積むときに「約 190 分」と出たため**（ADR-0042 段 4）。
 * 一晩かけて流す本数は分で言われても読み取れない。
 */
export const formatApproxDuration = (sec: number): string => {
  if (sec < 90) return `約 ${String(Math.round(sec))} 秒`
  const minutes = Math.round(sec / 60)
  if (minutes < 90) return `約 ${String(minutes)} 分`
  const hours = Math.floor(minutes / 60)
  const rest = minutes - hours * 60
  return rest === 0 ? `約 ${String(hours)} 時間` : `約 ${String(hours)} 時間 ${String(rest)} 分`
}
