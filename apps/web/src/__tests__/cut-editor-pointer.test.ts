import { describe, expect, it } from 'vitest'
import type { CutMark } from '@/lib/cut-marks'
import {
  POINTER_HIT_RADIUS_PX,
  ZOOM_STEP,
  canFollowPlayhead,
  centerView,
  isTimeInView,
  clientXForTime,
  markIndexAtClientX,
  panView,
  resolvePointerIntent,
  timeAtClientX,
  zoomView,
} from '@/lib/cut-editor-pointer'
import { MIN_VIEW_SPAN_SEC, viewDurationSec, type ViewRange } from '@/lib/waveform-draw'

/**
 * 波形の上のマウス操作。**掴んだ場所と動く物がずれないこと**を固定する。
 * ずれると、置き直す以外に直しようがない。
 */

const DURATION_SEC = 100
/** 幅 1000px で曲全体を映すので、1 秒 = 10px。数えやすい比率にしてある。 */
const BOUNDS = { left: 50, width: 1000 }
const FULL: ViewRange = { startSec: 0, endSec: DURATION_SEC }

const mark = (atSec: number): CutMark => ({ atSec, snappedTo: null })

describe('位置を秒にする', () => {
  it('左端は曲の先頭', () => {
    expect(timeAtClientX(BOUNDS.left, BOUNDS, FULL, DURATION_SEC)).toBeCloseTo(0, 6)
  })

  it('右端は曲の末尾', () => {
    expect(timeAtClientX(BOUNDS.left + BOUNDS.width, BOUNDS, FULL, DURATION_SEC)).toBeCloseTo(
      DURATION_SEC,
      6,
    )
  })

  it('要素の左端からの距離で決まる。画面の左端ではない', () => {
    expect(timeAtClientX(BOUNDS.left + 250, BOUNDS, FULL, DURATION_SEC)).toBeCloseTo(25, 6)
  })

  it('掴んだまま要素の外へ出ても、曲の外を指さない', () => {
    expect(timeAtClientX(BOUNDS.left - 500, BOUNDS, FULL, DURATION_SEC)).toBe(0)
    expect(timeAtClientX(BOUNDS.left + 9999, BOUNDS, FULL, DURATION_SEC)).toBeCloseTo(
      DURATION_SEC,
      6,
    )
  })

  it('寄って見ているときは窓の中で決まる', () => {
    const zoomed: ViewRange = { startSec: 40, endSec: 60 }

    expect(timeAtClientX(BOUNDS.left + 500, BOUNDS, zoomed, DURATION_SEC)).toBeCloseTo(50, 6)
  })

  it('幅が 0 のときは窓の先頭に畳む。0 除算で NaN を返さない', () => {
    const result = timeAtClientX(
      100,
      { left: 0, width: 0 },
      { startSec: 7, endSec: 9 },
      DURATION_SEC,
    )

    expect(result).toBe(7)
    expect(Number.isNaN(result)).toBe(false)
  })
})

describe('秒を位置にする', () => {
  it('秒にしてから戻すと元へ帰る', () => {
    const x = clientXForTime(37.5, BOUNDS, FULL, DURATION_SEC)

    expect(timeAtClientX(BOUNDS.left + x, BOUNDS, FULL, DURATION_SEC)).toBeCloseTo(37.5, 6)
  })
})

describe('区切りを掴む', () => {
  const marks = [mark(10), mark(50), mark(90)]

  it('線の真上で掴める', () => {
    expect(markIndexAtClientX(marks, BOUNDS.left + 500, BOUNDS, FULL, DURATION_SEC)).toBe(1)
  })

  it('掴める幅の内側なら掴める', () => {
    const x = BOUNDS.left + 500 + POINTER_HIT_RADIUS_PX

    expect(markIndexAtClientX(marks, x, BOUNDS, FULL, DURATION_SEC)).toBe(1)
  })

  it('掴める幅の外なら掴めない', () => {
    const x = BOUNDS.left + 500 + POINTER_HIT_RADIUS_PX + 1

    expect(markIndexAtClientX(marks, x, BOUNDS, FULL, DURATION_SEC)).toBe(-1)
  })

  it('区切りが無ければ掴めない', () => {
    expect(markIndexAtClientX([], BOUNDS.left + 500, BOUNDS, FULL, DURATION_SEC)).toBe(-1)
  })

  /**
   * 寄っていないと区切りは重なって見える。**近いほうを返す**ことを固定する。
   * 先に見つけたほうを返すと、掴んだつもりと違う区切りが動く。
   */
  it('重なって見えるときは近いほうを掴む', () => {
    const close = [mark(50), mark(50.3)]
    const nearSecond = BOUNDS.left + clientXForTime(50.28, BOUNDS, FULL, DURATION_SEC)

    expect(markIndexAtClientX(close, nearSecond, BOUNDS, FULL, DURATION_SEC)).toBe(1)
  })

  /**
   * 同じ 0.3 秒のずれが、引いて見れば 3px、寄って見れば 150px になる。
   * 掴める幅が秒で決まっていたら、寄るほど掴みにくくなって使えない。
   */
  it('掴める幅は画素で決まる。同じ秒差でも寄ると外れる', () => {
    const zoomed: ViewRange = { startSec: 49, endSec: 51 }
    const offByFull = BOUNDS.left + clientXForTime(50.3, BOUNDS, FULL, DURATION_SEC)
    const offByZoomed = BOUNDS.left + clientXForTime(50.3, BOUNDS, zoomed, DURATION_SEC)

    expect(markIndexAtClientX([mark(50)], offByFull, BOUNDS, FULL, DURATION_SEC)).toBe(0)
    expect(markIndexAtClientX([mark(50)], offByZoomed, BOUNDS, zoomed, DURATION_SEC)).toBe(-1)
  })
})

describe('掴んだときに始めること', () => {
  const marks = [mark(10), mark(50)]

  it('区切りの上なら動かす', () => {
    const intent = resolvePointerIntent(marks, BOUNDS.left + 500, BOUNDS, FULL, DURATION_SEC)

    expect(intent.kind).toBe('drag_mark')
    expect(intent.kind === 'drag_mark' ? intent.index : -1).toBe(1)
    expect(intent.atSec).toBeCloseTo(50, 6)
  })

  it('区切りの無いところなら聴く位置を変える', () => {
    const intent = resolvePointerIntent(marks, BOUNDS.left + 700, BOUNDS, FULL, DURATION_SEC)

    expect(intent.kind).toBe('seek')
    expect(intent.atSec).toBeCloseTo(70, 6)
  })

  it('区切りが 1 つも無ければ必ず聴く位置を変える', () => {
    expect(resolvePointerIntent([], BOUNDS.left + 1, BOUNDS, FULL, DURATION_SEC).kind).toBe('seek')
  })
})

describe('寄る / 引く', () => {
  it('掴んだ点が動かない', () => {
    const zoomed = zoomView(FULL, 30, ZOOM_STEP, DURATION_SEC)
    const before = clientXForTime(30, BOUNDS, FULL, DURATION_SEC)
    const after = clientXForTime(30, BOUNDS, zoomed, DURATION_SEC)

    expect(after).toBeCloseTo(before, 6)
  })

  it('寄ると窓が狭くなる', () => {
    expect(viewDurationSec(zoomView(FULL, 50, ZOOM_STEP, DURATION_SEC))).toBeLessThan(
      viewDurationSec(FULL),
    )
  })

  it('引くと曲からはみ出さない', () => {
    const wide = zoomView({ startSec: 40, endSec: 60 }, 50, 0.01, DURATION_SEC)

    expect(wide.startSec).toBeGreaterThanOrEqual(0)
    expect(wide.endSec).toBeLessThanOrEqual(DURATION_SEC)
  })

  it('これ以上は寄れない幅で止まる', () => {
    const tight = Array.from({ length: 40 }).reduce<ViewRange>(
      (view) => zoomView(view, 50, ZOOM_STEP, DURATION_SEC),
      FULL,
    )

    expect(viewDurationSec(tight)).toBeGreaterThanOrEqual(MIN_VIEW_SPAN_SEC)
  })

  it('倍率が 0 や負なら窓を変えない', () => {
    expect(zoomView(FULL, 50, 0, DURATION_SEC)).toEqual(FULL)
    expect(zoomView(FULL, 50, -2, DURATION_SEC)).toEqual(FULL)
  })

  it('掴んだ点が窓の外でも壊れない', () => {
    const view: ViewRange = { startSec: 40, endSec: 60 }
    const zoomed = zoomView(view, 0, ZOOM_STEP, DURATION_SEC)

    expect(Number.isFinite(zoomed.startSec)).toBe(true)
    expect(zoomed.startSec).toBeGreaterThanOrEqual(0)
  })
})

describe('横へ動かす', () => {
  it('幅を変えずに動く', () => {
    const view: ViewRange = { startSec: 40, endSec: 60 }
    const moved = panView(view, 5, DURATION_SEC)

    expect(moved.startSec).toBeCloseTo(45, 6)
    expect(viewDurationSec(moved)).toBeCloseTo(viewDurationSec(view), 6)
  })

  it('曲の端で止まる', () => {
    const view: ViewRange = { startSec: 40, endSec: 60 }

    expect(panView(view, -1000, DURATION_SEC).startSec).toBe(0)
    expect(panView(view, 1000, DURATION_SEC).endSec).toBeCloseTo(DURATION_SEC, 6)
  })
})

describe('再生位置を中央に保つ', () => {
  const zoomed: ViewRange = { startSec: 40, endSec: 60 }

  it('窓の中央が再生位置に合う', () => {
    const centered = centerView(zoomed, 70, DURATION_SEC)

    expect((centered.startSec + centered.endSec) / 2).toBeCloseTo(70, 6)
  })

  it('幅は変わらない', () => {
    expect(viewDurationSec(centerView(zoomed, 70, DURATION_SEC))).toBeCloseTo(
      viewDurationSec(zoomed),
      6,
    )
  })

  /**
   * 端では寄せきらない。曲の外の空白を見せるより、
   * 再生位置が中央から外れるほうが「どこを聴いているか」は分かりやすい。
   */
  it('曲の先頭では曲からはみ出さない', () => {
    const centered = centerView(zoomed, 2, DURATION_SEC)

    expect(centered.startSec).toBe(0)
    expect(viewDurationSec(centered)).toBeCloseTo(viewDurationSec(zoomed), 6)
  })

  it('曲の末尾では曲からはみ出さない', () => {
    const centered = centerView(zoomed, DURATION_SEC - 1, DURATION_SEC)

    expect(centered.endSec).toBeCloseTo(DURATION_SEC, 6)
    expect(viewDurationSec(centered)).toBeCloseTo(viewDurationSec(zoomed), 6)
  })

  /**
   * 毎フレーム呼ばれるので、動かないときに新しい物を作ると
   * 描き直しだけが延々と走る。
   */
  /** 既に中央に居るなら、受け取った窓をそのまま返す（描き直しを起こさない）。 */
  it('動かす必要が無ければ受け取った窓をそのまま返す', () => {
    expect(centerView(zoomed, 50, DURATION_SEC)).toBe(zoomed)
  })

  it('曲全体を映しているときは動かず、同じ物を返す', () => {
    expect(centerView(FULL, 80, DURATION_SEC)).toBe(FULL)
  })

  it('端で止まっている間は同じ物を返し続ける', () => {
    const atStart = centerView(zoomed, 2, DURATION_SEC)

    expect(centerView(atStart, 1, DURATION_SEC)).toBe(atStart)
  })

  it('再生位置が数値でなければ窓を変えない', () => {
    expect(centerView(zoomed, Number.NaN, DURATION_SEC)).toEqual(zoomed)
  })
})

describe('追従が目に見えるか', () => {
  it('曲全体を映しているなら動きようがない', () => {
    expect(canFollowPlayhead(FULL, DURATION_SEC)).toBe(false)
  })

  it('寄っていれば動く', () => {
    expect(canFollowPlayhead({ startSec: 40, endSec: 60 }, DURATION_SEC)).toBe(true)
  })

  it('曲より広い窓も動きようがない', () => {
    expect(canFollowPlayhead({ startSec: -50, endSec: 200 }, DURATION_SEC)).toBe(false)
  })
})

describe('その時刻が見えているか', () => {
  const zoomed: ViewRange = { startSec: 40, endSec: 60 }

  it('窓の中なら見えている', () => {
    expect(isTimeInView(50, zoomed, DURATION_SEC)).toBe(true)
  })

  it('窓の端はまだ見えている', () => {
    expect(isTimeInView(40, zoomed, DURATION_SEC)).toBe(true)
    expect(isTimeInView(60, zoomed, DURATION_SEC)).toBe(true)
  })

  it('窓の外なら見えていない', () => {
    expect(isTimeInView(39.9, zoomed, DURATION_SEC)).toBe(false)
    expect(isTimeInView(60.1, zoomed, DURATION_SEC)).toBe(false)
  })

  /** 止めている間にここへ飛ぶと、連れ戻さなければ再生位置がどこにも見えない。 */
  it('曲全体を映しているならどこでも見えている', () => {
    expect(isTimeInView(0, FULL, DURATION_SEC)).toBe(true)
    expect(isTimeInView(DURATION_SEC, FULL, DURATION_SEC)).toBe(true)
  })
})
