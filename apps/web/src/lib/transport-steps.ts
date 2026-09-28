/**
 * 再生の操作列の行き先（1 コマ戻る・進む、前の境目へ・次の境目へ）。**React を含まない。**
 *
 * 1 コマは書き出しと同じ 1/fps 秒。境目は Shot の頭と終わり、曲の頭と終わり。
 */

/** 同じ境目とみなす差。浮動小数の誤差で境目が 2 つに割れないように。 */
const SAME_POINT_SEC = 1e-6

/**
 * コマの頭とみなす幅（コマ数）。31/30 × 30 が 30.999… になる誤差や、音声の要素が位置を
 * マイクロ秒ほどの細かさで持つせいで 286 コマ目が 285.99999 で返ってくる揺れ（Chrome で実測）を吸う。
 * 30fps で約 33 マイクロ秒。コマの途中の位置を読み違えるほど広くはない。
 */
const FRAME_EPSILON = 1e-3

/**
 * 1 コマ進む（+1）・戻る（-1）。**いま出ているコマ**（その秒を含むコマ）から数え、
 * 行き先はコマの頭に乗せる。頭と尺の外へは出ない。
 */
export const frameStepTarget = (
  currentSec: number,
  direction: -1 | 1,
  fps: number,
  durationSec: number,
): number => {
  const shown = Math.floor(currentSec * fps + FRAME_EPSILON)
  return Math.min(Math.max((shown + direction) / fps, 0), durationSec)
}

/** 境目を昇順に。曲の頭（0）と、尺が分かれば終わりも含める。 */
export const editPointsOf = (
  shots: readonly { readonly startSec: number; readonly durationSec: number }[],
  durationSec: number | null,
): readonly number[] => {
  const all = [
    0,
    ...shots.flatMap((shot) => [shot.startSec, shot.startSec + shot.durationSec]),
    ...(durationSec === null ? [] : [durationSec]),
  ].sort((a, b) => a - b)
  return all.filter((sec, index) => index === 0 || sec - (all[index - 1] ?? sec) > SAME_POINT_SEC)
}

/**
 * 境目の上にいるとみなす幅（半コマ）。境目に止まっているときに押すと、
 * その境目に留まらず 1 つ前・後へ行く。
 */
const onPointSec = (fps: number): number => 0.5 / fps

/** 手前の境目。無ければ null。 */
export const previousEditPoint = (
  points: readonly number[],
  currentSec: number,
  fps: number,
): number | null => points.findLast((sec) => sec < currentSec - onPointSec(fps)) ?? null

/** 先の境目。無ければ null。 */
export const nextEditPoint = (
  points: readonly number[],
  currentSec: number,
  fps: number,
): number | null => points.find((sec) => sec > currentSec + onPointSec(fps)) ?? null
