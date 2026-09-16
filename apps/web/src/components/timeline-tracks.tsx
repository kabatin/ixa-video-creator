'use client'

import type {
  Shot,
  ShotId,
  TimelineClip,
  TimelineClipId,
  TimelineTrack,
  Transition,
} from '@ixa/domain'
import type { ReactNode } from 'react'
import {
  EDITABLE_TRACKS,
  VIDEO1_ROW,
  adjacentShotPairs,
  describeClipContent,
  formatClock,
  formatTimeSpan,
  lanesForTrack,
  rulerTicks,
  secondsToPx,
  timeSpanToRect,
  timelineRowLabel,
  transitionForPair,
  transitionTypeLabel,
} from '@/lib/timeline-display'

/**
 * Shot と TimelineClip を時間軸に並べて見せる帯（P5-4）。
 *
 * **操作性より「壊れた状態が見えること」を優先する。** ドラッグは持たない。
 * 位置と尺は数値で編集し、ここは結果を映すだけにする。
 */

const LABEL_WIDTH_CLASS = 'w-44'
const LANE_HEIGHT_PX = 44
const MIN_CONTENT_WIDTH_PX = 320

export type TimelineTracksProps = {
  readonly shots: readonly Shot[]
  readonly clips: readonly TimelineClip[]
  readonly transitions: readonly Transition[]
  /** VIDEO1 に実際に載った Shot。載らなかったものは色を変えて必ず見えるようにする。 */
  readonly renderedShotIds: ReadonlySet<ShotId>
  readonly durationSec: number
  readonly pxPerSec: number
  readonly selectedClipId: TimelineClipId | null
  readonly onSelectClip: (id: TimelineClipId) => void
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
  transitions,
  renderedShotIds,
  durationSec,
  pxPerSec,
  selectedClipId,
  onSelectClip,
}: TimelineTracksProps) => {
  const contentWidthPx = Math.max(secondsToPx(durationSec, pxPerSec), MIN_CONTENT_WIDTH_PX)
  const ticks = rulerTicks(durationSec, pxPerSec)
  const pairs = adjacentShotPairs(shots)

  const renderTrack = (track: TimelineTrack): ReactNode => {
    const lanes = lanesForTrack(clips, track)
    if (lanes.length === 0) return <EmptyLane message="クリップなし" />

    return lanes.map((lane) => (
      <div key={lane.layer} className="relative" style={{ height: LANE_HEIGHT_PX }}>
        <span className="absolute left-1 top-1 text-[10px] text-slate-400">
          {`layer ${String(lane.layer)}`}
        </span>
        {lane.clips.map((clip) => {
          const rect = timeSpanToRect(clip, pxPerSec)
          const selected = clip.id === selectedClipId
          return (
            <button
              key={clip.id}
              type="button"
              onClick={() => {
                onSelectClip(clip.id)
              }}
              aria-pressed={selected}
              title={`${formatTimeSpan(clip)} ${describeClipContent(clip.content)}`}
              className={`absolute top-4 overflow-hidden rounded px-1 text-left text-[11px] ring-1 ${
                selected
                  ? 'bg-sky-200 text-sky-900 ring-sky-500'
                  : 'bg-sky-100 text-sky-900 ring-sky-300 hover:bg-sky-200'
              }`}
              style={{ left: rect.leftPx, width: rect.widthPx, height: LANE_HEIGHT_PX - 20 }}
            >
              {describeClipContent(clip.content)}
            </button>
          )
        })}
      </div>
    ))
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div style={{ minWidth: contentWidthPx }}>
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
          <div className="relative" style={{ height: 28 }}>
            {pairs.map((pair) => {
              const transition = transitionForPair(transitions, pair)
              if (transition === null) return null
              return (
                <span
                  key={transition.id}
                  className="absolute top-1 -translate-x-1/2 whitespace-nowrap rounded bg-violet-100 px-1 text-[10px] text-violet-900 ring-1 ring-violet-300"
                  style={{ left: secondsToPx(pair.to.startSec, pxPerSec) }}
                >
                  {`${transitionTypeLabel(transition.type)} ${transition.durationSec.toFixed(2)}s`}
                </span>
              )
            })}
          </div>
        </Row>

        {EDITABLE_TRACKS.map((track) => (
          <Row key={track} label={timelineRowLabel(track)} contentWidthPx={contentWidthPx}>
            {renderTrack(track)}
          </Row>
        ))}
      </div>
    </div>
  )
}
