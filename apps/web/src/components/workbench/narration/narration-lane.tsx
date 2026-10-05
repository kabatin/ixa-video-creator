'use client'

import { useState } from 'react'
import { formatClock } from '@/lib/format-time'
import { draggedStartSec, nudgedStartSec, peaksPath, type LaneBlock } from '@/lib/narration-lane'

const LANE_HEIGHT_PX = 44
const BLOCK_HEIGHT_PX = 36
/** これより動かさなければ「押しただけ」とみなす（動かさない）。 */
const DRAG_THRESHOLD_PX = 3

/** 声ごとの色。声の並び順で色相を回す（決まった色の名前を持たない）。 */
const colorOf = (index: number): { readonly background: string; readonly border: string } => {
  const hue = (200 + index * 67) % 360
  return { background: `hsl(${String(hue)} 70% 50% / 0.28)`, border: `hsl(${String(hue)} 70% 60%)` }
}

type Drag = { readonly lineId: string; readonly originX: number; readonly dx: number }

/**
 * タイムラインのナレーションのレーン（ADR-0038）。置いた行が声の長さで並び、つかんで左右に動かせる
 * （矢印で 0.1 秒、Shift で 1 秒）。動かすと、その行のテロップも付いてくる（サーバで作り直す）。
 */
export const NarrationLane = ({
  blocks,
  pxPerSec,
  onMove,
}: {
  readonly blocks: readonly LaneBlock[]
  readonly pxPerSec: number
  readonly onMove: (lineId: string, startSec: number) => void
}) => {
  const [drag, setDrag] = useState<Drag | null>(null)

  if (blocks.length === 0) {
    return (
      <div
        className="m-1 flex items-center justify-center rounded border border-dashed border-line-strong text-xs text-muted"
        style={{ height: LANE_HEIGHT_PX - 8 }}
      >
        置いた行はまだありません（ナレーションの「再生位置から並べる」で置けます）
      </div>
    )
  }

  return (
    <div className="relative" style={{ height: LANE_HEIGHT_PX }}>
      {blocks.map((block) => {
        const dx = drag?.lineId === block.lineId ? drag.dx : 0
        const startSec = dx === 0 ? block.startSec : draggedStartSec(block.startSec, dx, pxPerSec)
        const widthPx = Math.max(block.durationSec * pxPerSec, 4)
        const color = colorOf(block.colorIndex)
        return (
          <div
            key={block.lineId}
            role="button"
            tabIndex={0}
            aria-label={`ナレーション「${block.label}」${formatClock(startSec)}（矢印で動かす）`}
            title={`${block.label}（${formatClock(startSec)}）`}
            className="absolute top-1 cursor-grab touch-none overflow-hidden rounded border text-xs text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            style={{
              left: startSec * pxPerSec,
              width: widthPx,
              height: BLOCK_HEIGHT_PX,
              background: color.background,
              borderColor: color.border,
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              setDrag({ lineId: block.lineId, originX: event.clientX, dx: 0 })
            }}
            onPointerMove={(event) => {
              if (drag?.lineId !== block.lineId) return
              setDrag({ ...drag, dx: event.clientX - drag.originX })
            }}
            onPointerUp={(event) => {
              if (drag?.lineId !== block.lineId) return
              const moved = event.clientX - drag.originX
              setDrag(null)
              if (Math.abs(moved) >= DRAG_THRESHOLD_PX) onMove(block.lineId, draggedStartSec(block.startSec, moved, pxPerSec))
            }}
            onPointerCancel={() => {
              setDrag(null)
            }}
            onKeyDown={(event) => {
              const next = nudgedStartSec(block.startSec, event.key, event.shiftKey)
              if (next === null) return
              event.preventDefault()
              onMove(block.lineId, next)
            }}
          >
            <svg aria-hidden className="absolute inset-0" width={widthPx} height={BLOCK_HEIGHT_PX}>
              <path d={peaksPath(block.peaks, widthPx, BLOCK_HEIGHT_PX)} stroke={color.border} strokeWidth={1} opacity={0.6} />
            </svg>
            <span className="relative block truncate px-1 leading-9">{block.label}</span>
          </div>
        )
      })}
    </div>
  )
}
