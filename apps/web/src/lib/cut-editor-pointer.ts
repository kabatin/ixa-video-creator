import type { CutMark } from '@/lib/cut-marks'
import { clampView, timeToX, xToTime, type ViewRange } from '@/lib/waveform-draw'

/**
 * 波形の上のマウス操作を、時刻と区切りの選択へ翻訳する。**React を含まない。**
 *
 * 画素と秒の変換そのものは `waveform-draw` の `timeToX` / `xToTime` が持つ。
 * ここがするのは「掴んだ場所に区切りがあるか」「掴んだ先はどの時刻か」の 2 つだけで、
 * 変換式を書き写さない（lessons L-016）。
 */

/**
 * 区切りを掴める幅（画素）。
 *
 * 線そのものは 2px だが、それだけでは掴めない。指でもマウスでも狙える幅として
 * 左右 6px を取る。**秒ではなく画素で決める。** 寄って見ているときほど
 * 同じ秒数が広い幅になり、離れて見ているときほど狭くなるべきなので、
 * 画面の上での狙いやすさが一定になるほうを選ぶ。
 */
export const POINTER_HIT_RADIUS_PX = 6

/** 掴んでいる要素の実寸。`getBoundingClientRect` の必要な部分だけ。 */
export type PointerBounds = {
  readonly left: number
  readonly width: number
}

/**
 * ポインタの位置を秒へ。**窓の外は端に丸める。**
 * 掴んだまま要素の外へ出たときに、曲の外を指したことにしないため。
 */
export const timeAtClientX = (
  clientX: number,
  bounds: PointerBounds,
  view: ViewRange,
  durationSec: number,
): number => {
  if (bounds.width <= 0) return view.startSec
  const safeView = clampView(view, durationSec)
  const x = Math.min(Math.max(clientX - bounds.left, 0), bounds.width)
  const sec = xToTime(x, safeView, bounds.width)
  return Math.min(Math.max(sec, 0), Math.max(durationSec, 0))
}

/** 秒を要素の中の x 座標へ。重ねて描く線の位置に使う。 */
export const clientXForTime = (
  sec: number,
  bounds: PointerBounds,
  view: ViewRange,
  durationSec: number,
): number => timeToX(sec, clampView(view, durationSec), bounds.width)

/**
 * その位置にある区切り。無ければ -1。
 *
 * **同じ距離なら先に見つけたほうではなく、より近いほうを返す。**
 * 寄って見ているときは区切りが重なって見えるので、掴んだつもりと違う区切りが
 * 動くと直しようがない。
 */
export const markIndexAtClientX = (
  marks: readonly CutMark[],
  clientX: number,
  bounds: PointerBounds,
  view: ViewRange,
  durationSec: number,
  radiusPx: number = POINTER_HIT_RADIUS_PX,
): number => {
  if (bounds.width <= 0) return -1
  const safeView = clampView(view, durationSec)
  const x = clientX - bounds.left

  return marks.reduce<{ index: number; distance: number }>(
    (best, mark, index) => {
      const distance = Math.abs(timeToX(mark.atSec, safeView, bounds.width) - x)
      if (distance > radiusPx || distance >= best.distance) return best
      return { index, distance }
    },
    { index: -1, distance: Number.POSITIVE_INFINITY },
  ).index
}

/**
 * 掴んだときに始めること。
 *
 * **区切りの上なら動かし、そうでなければ聴く位置を変える。**
 * 押した場所で意味が変わるのは、区切りが線として見えているから成り立つ。
 * 見えない操作を修飾キーに隠さない。
 */
export type PointerIntent =
  | { readonly kind: 'drag_mark'; readonly index: number; readonly atSec: number }
  | { readonly kind: 'seek'; readonly atSec: number }

export const resolvePointerIntent = (
  marks: readonly CutMark[],
  clientX: number,
  bounds: PointerBounds,
  view: ViewRange,
  durationSec: number,
  radiusPx: number = POINTER_HIT_RADIUS_PX,
): PointerIntent => {
  const atSec = timeAtClientX(clientX, bounds, view, durationSec)
  const index = markIndexAtClientX(marks, clientX, bounds, view, durationSec, radiusPx)
  return index >= 0 ? { kind: 'drag_mark', index, atSec } : { kind: 'seek', atSec }
}

// --- ズーム ---

/** 一度の操作で変わる倍率。 */
export const ZOOM_STEP = 1.5

/**
 * 窓を `anchorSec` を動かさないまま拡大・縮小する。
 *
 * **掴んだ点を固定する。** 中心を固定すると、見たい場所が画面の外へ逃げる。
 * 収まりの規則は `clampView` が持つので、ここでは掛けるだけにする。
 */
export const zoomView = (
  view: ViewRange,
  anchorSec: number,
  factor: number,
  durationSec: number,
): ViewRange => {
  const safeView = clampView(view, durationSec)
  const span = safeView.endSec - safeView.startSec
  if (!Number.isFinite(factor) || factor <= 0 || span <= 0) return safeView

  const anchor = Math.min(Math.max(anchorSec, safeView.startSec), safeView.endSec)
  const ratio = (anchor - safeView.startSec) / span
  const nextSpan = span / factor

  return clampView(
    { startSec: anchor - nextSpan * ratio, endSec: anchor + nextSpan * (1 - ratio) },
    durationSec,
  )
}

/** 窓を左右へ動かす。幅は変えない。 */
export const panView = (view: ViewRange, deltaSec: number, durationSec: number): ViewRange => {
  const safeView = clampView(view, durationSec)
  return clampView(
    { startSec: safeView.startSec + deltaSec, endSec: safeView.endSec + deltaSec },
    durationSec,
  )
}
