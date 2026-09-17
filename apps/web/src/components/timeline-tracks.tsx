'use client'

import type { Shot, ShotId, TimelineClip, TimelineClipId, TimelineTrack } from '@ixa/domain'
import { useRef, type ReactNode } from 'react'
import { TimelineClipLane } from '@/components/timeline-clip-lane'
import { TimelineTransitionRow } from '@/components/timeline-transition-row'
import {
  EDITABLE_TRACKS,
  VIDEO1_ROW,
  formatClock,
  formatTimeSpan,
  lanesForTrack,
  rulerTicks,
  secondsToPx,
  timeSpanToRect,
  timelineRowLabel,
} from '@/lib/timeline-display'
import type { ClipDragContext, ClipDragOutcome } from '@/lib/timeline-drag'
import type { InlineFormAnchor } from '@/components/timeline-inline-form'
import type { TransitionInsertionPoint } from '@/lib/timeline-insert'

/**
 * Shot と TimelineClip を時間軸に並べ、**その場で置いて動かせる**帯。
 *
 * 以前は「操作性より壊れた状態が見えることを優先する。ドラッグは持たない」
 * という作りだった。制作者の判断（2026-09-17）でその前提を変えている。
 * 壊れた状態が見えることは引き続き優先する（載らなかった Shot は色を変える）。
 *
 * **判定はここに書かない。** どこを掴んだか・どこへ挿せるかは
 * `timeline-drag.ts` と `timeline-insert.ts` が持つ。ここは並べて繋ぐだけ。
 */

const LABEL_WIDTH_CLASS = 'w-44'
const LANE_HEIGHT_PX = 44
const TRANSITION_ROW_HEIGHT_PX = 32
const MIN_CONTENT_WIDTH_PX = 320

/** テロップを置く層。いまは 1 層だけ扱う。 */
export const TEXT_INSERT_LAYER = 0

export type TimelineTracksProps = {
  readonly shots: readonly Shot[]
  readonly clips: readonly TimelineClip[]
  readonly transitionPoints: readonly TransitionInsertionPoint[]
  /** VIDEO1 に実際に載った Shot。載らなかったものは色を変えて必ず見えるようにする。 */
  readonly renderedShotIds: ReadonlySet<ShotId>
  readonly durationSec: number
  readonly pxPerSec: number
  readonly selectedClipId: TimelineClipId | null
  readonly busy: boolean
  /** いま開いている境目の時刻。開いている印を付けるため。 */
  readonly openTransitionAtSec: number | null
  readonly previewClipId: TimelineClipId | null
  readonly previewSpan: { readonly startSec: number; readonly durationSec: number } | null
  readonly onSelectClip: (id: TimelineClipId) => void
  readonly onOpenTransition: (point: TransitionInsertionPoint, anchor: InlineFormAnchor) => void
  readonly onOpenClip: (clip: TimelineClip, anchor: InlineFormAnchor) => void
  readonly onInsertText: (track: TimelineTrack, atSec: number, anchor: InlineFormAnchor) => void
  readonly onClipDragBegin: (clip: TimelineClip) => ClipDragContext
  readonly onClipDragMove: (clip: TimelineClip, outcome: ClipDragOutcome) => void
  readonly onClipDragEnd: (clip: TimelineClip, outcome: ClipDragOutcome) => void
  /** 帯の上に重ねるもの（その場で出る入力）。位置は呼び出し側が持つ。 */
  readonly overlay?: ReactNode
}

type RowProps = {
  readonly label: string
  readonly contentWidthPx: number
  readonly children: ReactNode
}

const Row = ({ label, contentWidthPx, children }: RowProps) => (
  <div className="flex border-t border-slate-200">
    <div
      className={`sticky left-0 z-10 ${LABEL_WIDTH_CLASS} shrink-0 border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700`}
    >
      {label}
    </div>
    <div className="relative" style={{ width: contentWidthPx }}>
      {children}
    </div>
  </div>
)

const EmptyLane = ({ message }: { readonly message: string }) => (
  <div
    className="m-1 flex items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-500"
    style={{ height: LANE_HEIGHT_PX - 8 }}
  >
    {message}
  </div>
)

export const TimelineTracks = ({
  shots,
  clips,
  transitionPoints,
  renderedShotIds,
  durationSec,
  pxPerSec,
  selectedClipId,
  busy,
  openTransitionAtSec,
  previewClipId,
  previewSpan,
  onSelectClip,
  onOpenTransition,
  onOpenClip,
  onInsertText,
  onClipDragBegin,
  onClipDragMove,
  onClipDragEnd,
  overlay,
}: TimelineTracksProps) => {
  const contentRef = useRef<HTMLDivElement>(null)
  const contentWidthPx = Math.max(secondsToPx(durationSec, pxPerSec), MIN_CONTENT_WIDTH_PX)
  const ticks = rulerTicks(durationSec, pxPerSec)

  /**
   * 子は自分がどの行にいるかを知らないので、画面上の縦位置だけを渡してくる。
   * **入力を重ねるのはこの器の中なので、器から見た座標へ直すのはここの仕事。**
   */
  const anchorFrom = (leftPx: number, clientY: number): InlineFormAnchor => ({
    leftPx,
    topPx: clientY - (contentRef.current?.getBoundingClientRect().top ?? 0),
  })

  const renderTrack = (track: TimelineTrack): ReactNode => {
    const lanes = lanesForTrack(clips, track)
    /**
     * TEXT は空でも置ける場所として出す。**空の帯を「クリップなし」で塞がない。**
     * 置ける場所が見えていないと、そこを押せることに気づけない。
     * 素材の選択が要る他のトラックは、この画面からは置けないので従来どおり。
     */
    if (lanes.length === 0 && track !== 'TEXT') return <EmptyLane message="クリップなし" />

    const laneList =
      lanes.length === 0 ? [{ layer: TEXT_INSERT_LAYER, clips: [] as TimelineClip[] }] : lanes

    return laneList.map((lane) => (
      <TimelineClipLane
        key={lane.layer}
        layer={lane.layer}
        clips={lane.clips}
        pxPerSec={pxPerSec}
        selectedClipId={selectedClipId}
        busy={busy}
        previewId={previewClipId}
        previewSpan={previewSpan}
        onSelect={onSelectClip}
        onOpen={(clip, leftPx, clientY) => {
          onOpenClip(clip, anchorFrom(leftPx, clientY))
        }}
        onDragBegin={onClipDragBegin}
        onDragMove={onClipDragMove}
        onDragEnd={onClipDragEnd}
        onInsertAt={(atSec, leftPx, clientY) => {
          // 置けるのは TEXT だけ。他は素材の選択が要るのでこの画面では受けない。
          if (track === 'TEXT') onInsertText(track, atSec, anchorFrom(leftPx, clientY))
        }}
      />
    ))
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div ref={contentRef} className="relative" style={{ minWidth: contentWidthPx }}>
        <Row label={`尺 ${formatClock(durationSec)}`} contentWidthPx={contentWidthPx}>
          <div className="relative h-8">
            {ticks.map((tick) => (
              <span
                key={tick.sec}
                className="absolute top-0 border-l border-slate-300 pl-1 text-[10px] text-slate-500"
                style={{ left: tick.leftPx, height: '100%' }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </Row>

        <Row label={timelineRowLabel(VIDEO1_ROW)} contentWidthPx={contentWidthPx}>
          {shots.length === 0 ? (
            <EmptyLane message="Shot がありません" />
          ) : (
            <div className="relative" style={{ height: LANE_HEIGHT_PX }}>
              {shots.map((shot) => {
                const rect = timeSpanToRect(shot, pxPerSec)
                const rendered = renderedShotIds.has(shot.id)
                return (
                  <div
                    key={shot.id}
                    title={`${shot.code} ${formatTimeSpan(shot)}`}
                    className={`absolute top-2 overflow-hidden rounded px-1 text-[11px] ring-1 ${
                      rendered
                        ? 'bg-slate-200 text-slate-800 ring-slate-400'
                        : 'border border-dashed bg-amber-50 text-amber-900 ring-amber-400'
                    }`}
                    style={{ left: rect.leftPx, width: rect.widthPx, height: LANE_HEIGHT_PX - 16 }}
                  >
                    {rendered ? shot.code : `${shot.code}（Take 無し）`}
                  </div>
                )
              })}
            </div>
          )}
        </Row>

        <Row label="Transition" contentWidthPx={contentWidthPx}>
          <TimelineTransitionRow
            points={transitionPoints}
            pxPerSec={pxPerSec}
            heightPx={TRANSITION_ROW_HEIGHT_PX}
            busy={busy}
            openAtSec={openTransitionAtSec}
            onOpen={(point, leftPx, clientY) => {
              onOpenTransition(point, anchorFrom(leftPx, clientY))
            }}
          />
        </Row>

        {EDITABLE_TRACKS.map((track) => (
          <Row key={track} label={timelineRowLabel(track)} contentWidthPx={contentWidthPx}>
            {renderTrack(track)}
          </Row>
        ))}

        {overlay}
      </div>
    </div>
  )
}
