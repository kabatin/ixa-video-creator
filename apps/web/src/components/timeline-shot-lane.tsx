'use client'

import type { Shot, ShotId } from '@ixa/domain'
import { useRef, type KeyboardEvent } from 'react'
import { ShotPoster } from '@/components/shot-poster'
import { useShotEdgeDrag, type ShotEdgeDragProps, type ShotEdgeHandle } from '@/components/use-shot-edge-drag'
import type { ContextMenuTriggerProps } from '@/components/workbench/use-context-menu'
import { chipRingClass, describeDrift, type ShotBeatAlignmentView } from '@/lib/beat-alignment-view'
import { formatDuration } from '@/lib/format-time'
import { posterViewFor, type ShotPosterMap } from '@/lib/shot-posters'
import { formatTimeSpan, timeSpanToRect } from '@/lib/timeline-display'
import { clipDragHandleLabel, edgeGrabWidthPx } from '@/lib/timeline-drag'

/**
 * VIDEO1 の帯（Shot を時間軸に並べる）。押して選び、**端をつまんで長さを変える**（制作者 2026-10-02）。
 * 端の動きと当て方は `use-shot-edge-drag`。ここは並べて繋ぐだけ。
 */

const LANE_HEIGHT_PX = 44

export type TimelineShotLaneProps = {
  readonly shots: readonly Shot[]
  readonly pxPerSec: number
  /** VIDEO1 に実際に載った Shot。載らなかったものは色を変えて必ず見えるようにする。 */
  readonly renderedShotIds: ReadonlySet<ShotId>
  readonly posters?: ShotPosterMap
  readonly alignments: ReadonlyMap<ShotId, ShotBeatAlignmentView> | null
  readonly selectedShotId: ShotId | null
  readonly onSelectShot?: (shotId: ShotId) => void
  readonly shotContextMenu?: (shot: Shot) => ContextMenuTriggerProps
  /** 端をつまんで長さを変える口。渡さなければ端は掴めない（従来どおり）。 */
  readonly edges?: ShotEdgeDragProps
}

const HANDLES: readonly ShotEdgeHandle[] = ['start', 'end']

export const TimelineShotLane = ({
  shots,
  pxPerSec,
  renderedShotIds,
  posters,
  alignments,
  selectedShotId,
  onSelectShot,
  shotContextMenu,
  edges,
}: TimelineShotLaneProps) => {
  const laneRef = useRef<HTMLDivElement>(null)
  const { handleProps, spanOf, previewing } = useShotEdgeDrag(shots, pxPerSec, laneRef, edges)

  return (
    <div ref={laneRef} className="relative" style={{ height: LANE_HEIGHT_PX }}>
      {shots.map((shot) => {
        const span = spanOf(shot)
        const rect = timeSpanToRect(span, pxPerSec)
        const rendered = renderedShotIds.has(shot.id)
        const poster = posters === undefined ? null : posterViewFor(posters, shot.id)
        const alignment = alignments?.get(shot.id) ?? null
        const selected = shot.id === selectedShotId
        const menu = shotContextMenu?.(shot)
        const moving = previewing(shot)
        const grabPx = edgeGrabWidthPx(rect.widthPx)
        return (
          <div
            key={shot.id}
            {...menu}
            {...(onSelectShot === undefined
              ? {}
              : {
                  role: 'button',
                  tabIndex: 0,
                  'aria-pressed': selected,
                  onClick: () => {
                    onSelectShot(shot.id)
                  },
                  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                    // Shift+F10・メニューキーはメニューへ（それ以外はこれまでどおり）。
                    menu?.onKeyDown(event)
                    if (event.defaultPrevented) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    // 帯の上の Space を再生に流さない（L-018）。
                    event.stopPropagation()
                    onSelectShot(shot.id)
                  },
                })}
            title={
              alignment === null
                ? `${shot.code} ${formatTimeSpan(span)}`
                : `${shot.code} ${formatTimeSpan(span)} / ${describeDrift(alignment)}`
            }
            className={`absolute top-2 overflow-hidden rounded px-1 text-xs ${
              rendered ? 'bg-line text-text' : 'border border-dashed bg-warn/10 text-warn'
            } ${chipRingClass({ rendered, alignment: alignment?.alignment ?? null })} ${
              // 拍の色は ring。選択は outline にして両方を同時に見せる。
              selected ? 'outline outline-2 outline-offset-1 outline-accent' : ''
            } ${onSelectShot === undefined ? '' : 'cursor-pointer'} ${moving ? 'opacity-80' : ''}`}
            style={{ ...menu?.style, left: rect.leftPx, width: rect.widthPx, height: LANE_HEIGHT_PX - 16 }}
          >
            {poster !== null && (
              <>
                <ShotPoster
                  url={poster.url}
                  reason={poster.reason}
                  alt={`${shot.code} のサムネイル`}
                  size="chip"
                  pending={poster.pending}
                />
                {/* 絵の上に字は読めない。地の色を薄く被せてから字を乗せる。 */}
                <span aria-hidden className="absolute inset-0 bg-bg/50" />
              </>
            )}
            {/* 細い札で長さが 2 行目に落ちないよう、1 行に収めて端は切る。 */}
            <span className="relative whitespace-nowrap">
              {/* 動かしている間は新しい長さを出す（隣のカットも）。 */}
              {moving ? `${shot.code} ${formatDuration(span.durationSec)}` : rendered ? shot.code : `${shot.code}（Take 無し）`}
            </span>
            {edges !== undefined &&
              HANDLES.map((handle) => (
                // 掴みしろ。キーボードからはインスペクターの「開始」「尺」で直す（数値のほうが正確に置ける）。
                <span
                  key={handle}
                  aria-hidden="true"
                  title={`${shot.code} の${clipDragHandleLabel(handle)}（ドラッグで長さを変える。Option で隣を動かさない）`}
                  className={`absolute inset-y-0 ${handle === 'start' ? 'left-0' : 'right-0'} cursor-ew-resize touch-none hover:bg-accent/40`}
                  style={{ width: grabPx }}
                  {...handleProps(shot, handle)}
                />
              ))}
          </div>
        )
      })}
    </div>
  )
}
