'use client'

import type { TimelineClip, TimelineClipId } from '@ixa/domain'
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import {
  applyClipDrag,
  beginClipDrag,
  clipDragHandleLabel,
  clipHandleAtClientX,
  EDGE_GRAB_WIDTH_PX,
  edgeGrabWidthPx,
  timelineSecAtClientX,
  type ClipDragContext,
  type ClipDragOutcome,
  type ClipDragStart,
} from '@/lib/timeline-drag'
import { describeClipContent, formatTimeSpan, timeSpanToRect } from '@/lib/timeline-display'

/**
 * 1 つの層のクリップを並べ、**その場で掴んで動かせる**帯。
 *
 * 以前は帯の下の一覧に数値を打ち込んで動かしていた。
 * 動画編集ソフトでは掴んで動かし、端を引いて尺を変えるのが普通なので、それに合わせる。
 *
 * **計算はここに書かない。** どこを掴んだか・どこへ動くか・止めた理由は
 * すべて `timeline-drag.ts` の純粋関数が決める。ここは指の動きを渡して結果を受けるだけ。
 */

const LANE_HEIGHT_PX = 44
const CLIP_HEIGHT_PX = LANE_HEIGHT_PX - 20

export type TimelineClipLaneProps = {
  readonly layer: number
  readonly clips: readonly TimelineClip[]
  readonly pxPerSec: number
  readonly selectedClipId: TimelineClipId | null
  readonly busy: boolean
  /** 動かしている最中の見た目。確定前の位置を映す。 */
  readonly previewId: TimelineClipId | null
  readonly previewSpan: { readonly startSec: number; readonly durationSec: number } | null
  readonly onSelect: (id: TimelineClipId) => void
  /** クリップを押した。`clientY` は入力を出す縦の場所を親が計算するために要る。 */
  readonly onOpen: (clip: TimelineClip, leftPx: number, clientY: number) => void
  /** 掴んだ。**この時点で吸着候補を作る**（動かすたびに作らない）。 */
  readonly onDragBegin: (clip: TimelineClip) => ClipDragContext
  readonly onDragMove: (clip: TimelineClip, outcome: ClipDragOutcome) => void
  readonly onDragEnd: (clip: TimelineClip, outcome: ClipDragOutcome) => void
  /** 空いているところを押した。テロップを挿す起点。 */
  readonly onInsertAt: (atSec: number, leftPx: number, clientY: number) => void
}

type DragState = {
  readonly clip: TimelineClip
  readonly start: ClipDragStart
  readonly context: ClipDragContext
  readonly pointerId: number
}

/** 端を掴める幅。短いクリップでは本体が残るよう、`timeline-drag` 側が縮める。 */
const grabWidthFor = (clip: TimelineClip, pxPerSec: number): number =>
  edgeGrabWidthPx(clip.durationSec * pxPerSec, EDGE_GRAB_WIDTH_PX)

export const TimelineClipLane = ({
  layer,
  clips,
  pxPerSec,
  selectedClipId,
  busy,
  previewId,
  previewSpan,
  onSelect,
  onOpen,
  onDragBegin,
  onDragMove,
  onDragEnd,
  onInsertAt,
}: TimelineClipLaneProps) => {
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  /** 掴んでから離すまでに動いたか。動いていなければ「押した」として扱う。 */
  const movedRef = useRef(false)

  const boundsOf = (): { readonly left: number } => ({
    left: laneRef.current?.getBoundingClientRect().left ?? 0,
  })

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (busy) return
    const bounds = boundsOf()
    const atSec = timelineSecAtClientX(event.clientX, bounds, pxPerSec)

    const hit = clips.find(
      (clip) =>
        clipHandleAtClientX(clip, event.clientX, bounds, pxPerSec, grabWidthFor(clip, pxPerSec)) !==
        null,
    )
    if (hit === undefined) {
      onInsertAt(atSec, atSec * pxPerSec, laneRef.current?.getBoundingClientRect().bottom ?? 0)
      return
    }

    const start = beginClipDrag(hit, event.clientX, bounds, pxPerSec, grabWidthFor(hit, pxPerSec))
    if (start === null) return

    // 捕捉は上乗せ。失敗しても引きずりは始める（`cut-waveform-overlay.tsx` と同じ判断）。
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 捕捉できないだけ。要素の中にいる限り pointermove は届く。
    }
    movedRef.current = false
    dragRef.current = { clip: hit, start, context: onDragBegin(hit), pointerId: event.pointerId }
    onSelect(hit.id)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const outcome = applyClipDrag(
      drag.start,
      event.clientX,
      boundsOf(),
      pxPerSec,
      drag.context,
    )
    if (outcome.moved) movedRef.current = true
    onDragMove(drag.clip, outcome)
  }

  const finish = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // 捕捉していなければ解く物も無い。後始末は続ける。
    }

    const outcome = applyClipDrag(drag.start, event.clientX, boundsOf(), pxPerSec, drag.context)
    // 動かしていないなら「押した」。入力を開く。
    if (!movedRef.current && !outcome.moved) {
      onOpen(
        drag.clip,
        (drag.clip.startSec + drag.clip.durationSec / 2) * pxPerSec,
        laneRef.current?.getBoundingClientRect().bottom ?? 0,
      )
      return
    }
    onDragEnd(drag.clip, outcome)
  }

  return (
    <div
      ref={laneRef}
      className="relative"
      style={{ height: LANE_HEIGHT_PX }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <span className="pointer-events-none absolute left-1 top-1 text-[10px] text-muted">
        {`layer ${String(layer)}`}
      </span>

      {clips.map((clip) => {
        const span = clip.id === previewId && previewSpan !== null ? previewSpan : clip
        const rect = timeSpanToRect(span, pxPerSec)
        const selected = clip.id === selectedClipId
        const grabPx = grabWidthFor(clip, pxPerSec)

        return (
          <div
            key={clip.id}
            // ボタンにしない。押す・掴む・端を引くの 3 つを 1 つの要素で受けるため、
            // 判定は `timeline-drag` に任せて親が pointer を捌く。
            // **キーボードからは帯の下の一覧で操作する**（数値のほうが正確に置ける）。
            aria-hidden="true"
            title={`${formatTimeSpan(span)} ${describeClipContent(clip.content)}`}
            className={`absolute top-4 touch-none select-none overflow-hidden rounded text-left text-[11px] ring-1 ${
              selected
                ? 'bg-info/25 text-text ring-info/60'
                : 'bg-info/10 text-text ring-info/60 hover:bg-info/25'
            } ${clip.id === previewId ? 'opacity-80 ring-2 ring-info/60' : ''}`}
            style={{ left: rect.leftPx, width: rect.widthPx, height: CLIP_HEIGHT_PX }}
          >
            {/* 端の掴みしろ。幅は本体を食いつぶさないよう `timeline-drag` が決める。 */}
            <span
              aria-hidden="true"
              title={clipDragHandleLabel('start')}
              className="absolute inset-y-0 left-0 cursor-ew-resize bg-info/30"
              style={{ width: grabPx }}
            />
            <span
              aria-hidden="true"
              title={clipDragHandleLabel('end')}
              className="absolute inset-y-0 right-0 cursor-ew-resize bg-info/30"
              style={{ width: grabPx }}
            />
            <span className="pointer-events-none block cursor-grab truncate px-1 leading-6">
              {describeClipContent(clip.content)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
