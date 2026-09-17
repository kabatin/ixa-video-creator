'use client'

import { useRef, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react'
import {
  ZOOM_STEP,
  clientXForTime,
  resolvePointerIntent,
  timeAtClientX,
  type PointerBounds,
} from '@/lib/cut-editor-pointer'
import type { CutMark } from '@/lib/cut-marks'
import { formatClock } from '@/lib/format-time'
import { clampView, type ViewRange } from '@/lib/waveform-draw'

/**
 * 波形の上に重ねる操作の層（Architect が配線のために持つ）。
 *
 * 描くのは `waveform-canvas`、区切りの計算は `cut-marks`、座標の変換は
 * `cut-editor-pointer` にある。ここがするのは**掴む・引きずる・離す**の間を繋ぐことだけで、
 * 規則も計算も持たない。
 *
 * 押した場所で意味が変えてある。
 * **区切りの線の上なら動かし、それ以外なら聴く位置を変える。**
 * 隠れた修飾キーを覚えさせずに済むのは、区切りが線として見えているため。
 */

export type CutWaveformOverlayProps = {
  readonly marks: readonly CutMark[]
  /** 選んでいる区切り。未選択は -1。 */
  readonly selectedIndex: number
  readonly currentSec: number
  readonly durationSec: number
  readonly view: ViewRange
  readonly disabled: boolean
  readonly onSeek: (sec: number) => void
  readonly onSelectMark: (index: number) => void
  /** 引きずっている最中も呼ばれる。確定は `onDragEnd`。 */
  readonly onMoveMark: (index: number, sec: number) => void
  readonly onDragEnd: () => void
  readonly onZoom: (anchorSec: number, factor: number) => void
}

type DragState = { readonly index: number; readonly pointerId: number }

const boundsOf = (element: HTMLElement): PointerBounds => {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, width: rect.width }
}

/** 窓の外にある印は描かない。曲全体で 200 本まで置けるので、毎回全部は置かない。 */
const isVisible = (sec: number, view: ViewRange): boolean =>
  sec >= view.startSec && sec <= view.endSec

export const CutWaveformOverlay = ({
  marks,
  selectedIndex,
  currentSec,
  durationSec,
  view,
  disabled,
  onSeek,
  onSelectMark,
  onMoveMark,
  onDragEnd,
  onZoom,
}: CutWaveformOverlayProps) => {
  const layerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const safeView = clampView(view, durationSec)

  const positionOf = (sec: number): string => {
    const element = layerRef.current
    if (element === null) return '0px'
    return `${String(clientXForTime(sec, boundsOf(element), safeView, durationSec))}px`
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    const bounds = boundsOf(event.currentTarget)
    const intent = resolvePointerIntent(marks, event.clientX, bounds, safeView, durationSec)

    if (intent.kind === 'seek') {
      onSeek(intent.atSec)
      return
    }

    /**
     * 掴んだ指を離すまで、要素の外へ出ても追い続ける。
     *
     * **捕捉に失敗しても引きずりは始める。** `setPointerCapture` は
     * 対応する実ポインタが無いと `NotFoundError` を投げる。投げたところで
     * 止めてしまうと、掴めたように見えて何も動かない。捕捉は
     * 「要素の外へ出ても追える」ための上乗せであって、引きずりの前提ではない。
     */
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 捕捉できないだけ。要素の中にいる限り pointermove は届く。
    }
    dragRef.current = { index: intent.index, pointerId: event.pointerId }
    onSelectMark(intent.index)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const sec = timeAtClientX(event.clientX, boundsOf(event.currentTarget), safeView, durationSec)
    onMoveMark(drag.index, sec)
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // 捕捉していなければ解く物も無い。引きずりの後始末は続ける。
    }
    onDragEnd()
  }

  /**
   * ホイールで寄る / 引く。**修飾キーの要らない素の回転は受けない。**
   * ページを縦に送るつもりの回転で波形が拡大すると、読む場所を見失う。
   */
  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (disabled || (!event.ctrlKey && !event.metaKey && !event.altKey)) return
    const anchorSec = timeAtClientX(
      event.clientX,
      boundsOf(event.currentTarget),
      safeView,
      durationSec,
    )
    onZoom(anchorSec, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
  }

  return (
    <div
      ref={layerRef}
      className={`absolute inset-0 ${disabled ? '' : 'cursor-crosshair'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
    >
      {marks.map((mark, index) =>
        !isVisible(mark.atSec, safeView) ? null : (
          <div
            key={`${String(index)}-${String(mark.atSec)}`}
            aria-hidden="true"
            className={`absolute top-0 bottom-0 w-0.5 -translate-x-1/2 ${
              index === selectedIndex ? 'bg-sky-500' : 'bg-slate-900'
            }`}
            style={{ left: positionOf(mark.atSec) }}
          >
            <span
              className={`absolute -top-px left-1/2 h-2 w-2 -translate-x-1/2 rounded-sm ${
                index === selectedIndex ? 'bg-sky-500' : 'bg-slate-900'
              }`}
            />
          </div>
        ),
      )}

      {/* 再生位置。区切りより手前に描く。どこを聴いているかが最も動く情報なので。 */}
      {isVisible(currentSec, safeView) && (
        <div
          aria-hidden="true"
          className="absolute top-0 bottom-0 w-px -translate-x-1/2 bg-rose-500"
          style={{ left: positionOf(currentSec) }}
        />
      )}

      {/**
       * 目で見えている内容を、画面読み上げにも同じだけ渡す。
       * 波形そのものは canvas の `aria-label` が説明している。
       */}
      <p className="sr-only" role="status">
        {`再生位置 ${formatClock(currentSec)}。区切り ${String(marks.length)} 個。`}
      </p>
    </div>
  )
}
