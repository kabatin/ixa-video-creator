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

/**
 * 窓の中央を `atSec` に合わせる。幅は変えない。
 *
 * 再生位置を真ん中に置いて曲のほうを流すための計算。**曲の端では寄せきらない。**
 * 先頭や末尾では窓が曲からはみ出すので `clampView` が止め、
 * そのぶん再生位置は中央から外れる。これは正しい振る舞いで、
 * 端を越えた空白を見せないほうが、どこを聴いているか分かりやすい。
 *
 * **動かす必要が無いときは受け取った窓をそのまま返す。**
 * 追従は毎フレーム呼ばれるため、同じ値の新しい物を作り続けると
 * 描き直しだけが延々と走る。曲全体を映しているときや端で止まっているときは
 * 窓が動かないので、そこで止める意味が大きい。
 */
export const centerView = (view: ViewRange, atSec: number, durationSec: number): ViewRange => {
  const safeView = clampView(view, durationSec)
  const span = safeView.endSec - safeView.startSec
  if (!Number.isFinite(atSec) || span <= 0) return safeView

  const half = span / 2
  const next = clampView({ startSec: atSec - half, endSec: atSec + half }, durationSec)

  // `clampView` は毎回新しい物を返すので、**受け取った窓そのもの**と比べる。
  // `safeView` と比べると、値が同じでも常に別の物を返してしまい、同一性で止められない。
  return next.startSec === view.startSec && next.endSec === view.endSec ? view : next
}

/**
 * 追従が目に見えるか。
 *
 * 曲全体が収まっている窓では、中央へ寄せても `clampView` が押し戻すので**何も起きない**。
 * 設定が効いていないのか、効いた上で動く必要が無いのかは利用者には区別できないので、
 * 画面で説明するためにここで判定する（lessons L-015）。
 */
export const canFollowPlayhead = (view: ViewRange, durationSec: number): boolean => {
  const safeView = clampView(view, durationSec)
  return safeView.endSec - safeView.startSec < durationSec
}

/**
 * その時刻がいま見えているか。
 *
 * **止めている間の追従の判断に使う。** 鳴っている間は毎フレーム中央へ寄せればよいが、
 * 止めている間まで同じことをすると、窓を自分で送った直後に引き戻されて動かせない。
 * かといって何もしないと、シークした先が窓の外のまま**再生位置がどこにも見えなくなる**。
 * 見えているうちは触らず、外へ出たときだけ連れ戻すのが両立する形になる。
 */
export const isTimeInView = (sec: number, view: ViewRange, durationSec: number): boolean => {
  const safeView = clampView(view, durationSec)
  return sec >= safeView.startSec && sec <= safeView.endSec
}
