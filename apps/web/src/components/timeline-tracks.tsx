'use client'

import type { Shot, ShotId, TimelineClip, TimelineClipId, TimelineTrack } from '@ixa/domain'
import { useRef, type ReactNode } from 'react'
import { ShotPoster } from '@/components/shot-poster'
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
import type { ShotPosterMap } from '@/lib/shot-posters'
import { posterViewFor } from '@/lib/shot-posters'
import { playheadLeftPx, seekSecAtClientX } from '@/lib/timeline-playhead'
import {
  alignmentByShotId,
  beatAlignmentToneClass,
  chipRingClass,
  describeDrift,
  summarizeBeatAlignment,
  type BeatAlignmentSource,
  type ShotBeatAlignmentView,
} from '@/lib/beat-alignment-view'

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
  readonly onOpenTransition: (
    point: TransitionInsertionPoint,
    anchor: InlineFormAnchor,
    opener: HTMLElement | null,
  ) => void
  readonly onOpenClip: (
    clip: TimelineClip,
    anchor: InlineFormAnchor,
    opener: HTMLElement | null,
  ) => void
  readonly onInsertText: (
    track: TimelineTrack,
    atSec: number,
    anchor: InlineFormAnchor,
    opener: HTMLElement | null,
  ) => void
  readonly onClipDragBegin: (clip: TimelineClip) => ClipDragContext
  readonly onClipDragMove: (clip: TimelineClip, outcome: ClipDragOutcome) => void
  readonly onClipDragEnd: (clip: TimelineClip, outcome: ClipDragOutcome) => void
  /**
   * VIDEO1 の帯に敷くサムネイル。**渡さなければ帯は従来どおり**（絵を敷かない）。
   * 渡した Shot の分だけ絵が下地になり、文字は暗い被せの上に乗る。
   */
  readonly posters?: ShotPosterMap
  /** 再生ヘッドの位置（秒）。null なら描かない。 */
  readonly playheadSec?: number | null
  /** 目盛りの帯を押した。その秒へ飛ぶ。 */
  readonly onSeek?: (sec: number) => void
  /** 帯の上に重ねるもの（その場で出る入力）。位置は呼び出し側が持つ。 */
  readonly overlay?: ReactNode
  /**
   * 拍とのズレ。**渡さなければ縁は従来どおり**（拍の色を出さない）。
   *
   * 判定も数え方もここには無い。`@ixa/domain` の `alignBoundary` が出した結果を
   * `beat-alignment-view` が色と文に直したものを、そのまま並べるだけ。
   */
  readonly beatAlignment?: {
    readonly source: BeatAlignmentSource
    readonly trackTitle: string | null
    readonly views: readonly ShotBeatAlignmentView[]
  }
}

type RowProps = {
  readonly label: string
  readonly contentWidthPx: number
  readonly children: ReactNode
}

const Row = ({ label, contentWidthPx, children }: RowProps) => (
  <div className="flex border-t border-line">
    <div
      className={`sticky left-0 z-10 ${LABEL_WIDTH_CLASS} shrink-0 border-r border-line bg-surface-2 px-3 py-2 text-xs font-medium text-text`}
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
    className="m-1 flex items-center justify-center rounded border border-dashed border-line-strong text-xs text-muted"
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
  posters,
  playheadSec = null,
  onSeek,
  overlay,
  beatAlignment,
}: TimelineTracksProps) => {
  const contentRef = useRef<HTMLDivElement>(null)
  const alignments = beatAlignment === undefined ? null : alignmentByShotId(beatAlignment.views)
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
          // 帯の上のクリップはボタンではないので、戻す先は無い（マウスで開く）。
          onOpenClip(clip, anchorFrom(leftPx, clientY), null)
        }}
        onDragBegin={onClipDragBegin}
        onDragMove={onClipDragMove}
        onDragEnd={onClipDragEnd}
        onInsertAt={(atSec, leftPx, clientY) => {
          // 置けるのは TEXT だけ。他は素材の選択が要るのでこの画面では受けない。
          if (track === 'TEXT') onInsertText(track, atSec, anchorFrom(leftPx, clientY), null)
        }}
      />
    ))
  }

  const summary =
    beatAlignment === undefined
      ? null
      : summarizeBeatAlignment({
          source: beatAlignment.source,
          trackTitle: beatAlignment.trackTitle,
          views: beatAlignment.views,
        })

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      {summary !== null && (
        /* **色だけでは全体像が掴めない。** 何件が外れているかを必ず文でも出す。 */
        /* 帯は横に流れる。**要約は流して消さない**ので左に貼り付ける。 */
        <p
          className={`sticky left-0 border-b border-line px-3 py-2 text-xs ${beatAlignmentToneClass(summary.tone)}`}
        >
          {summary.text}
        </p>
      )}
      <div ref={contentRef} className="relative" style={{ minWidth: contentWidthPx }}>
        <Row label={`尺 ${formatClock(durationSec)}`} contentWidthPx={contentWidthPx}>
          {/* 目盛りを押したらその秒へ。判定は `timeline-playhead` が持つ。 */}
          <div
            className={`relative h-8 ${onSeek === undefined ? '' : 'cursor-pointer'}`}
            onPointerDown={(event) => {
              if (onSeek === undefined) return
              const left = event.currentTarget.getBoundingClientRect().left
              onSeek(seekSecAtClientX(event.clientX, { left }, pxPerSec, durationSec))
            }}
          >
            {ticks.map((tick) => (
              <span
                key={tick.sec}
                className="absolute top-0 border-l border-line-strong pl-1 text-[10px] text-muted"
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
                const poster = posters === undefined ? null : posterViewFor(posters, shot.id)
                const alignment = alignments?.get(shot.id) ?? null
                return (
                  <div
                    key={shot.id}
                    title={
                      alignment === null
                        ? `${shot.code} ${formatTimeSpan(shot)}`
                        : `${shot.code} ${formatTimeSpan(shot)} / ${describeDrift(alignment)}`
                    }
                    className={`absolute top-2 overflow-hidden rounded px-1 text-[11px] ${
                      rendered ? 'bg-line text-text' : 'border border-dashed bg-warn/10 text-warn'
                    } ${chipRingClass({ rendered, alignment: alignment?.alignment ?? null })}`}
                    style={{ left: rect.leftPx, width: rect.widthPx, height: LANE_HEIGHT_PX - 16 }}
                  >
                    {poster !== null && (
                      <>
                        <ShotPoster
                          url={poster.url}
                          reason={poster.reason}
                          alt={`${shot.code} のサムネイル`}
                          size="chip"
                        />
                        {/* 絵の上に字は読めない。地の色を薄く被せてから字を乗せる。 */}
                        <span aria-hidden className="absolute inset-0 bg-bg/50" />
                      </>
                    )}
                    <span className="relative">
                      {rendered ? shot.code : `${shot.code}（Take 無し）`}
                    </span>
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
            onOpen={(point, leftPx, clientY, opener) => {
              onOpenTransition(point, anchorFrom(leftPx, clientY), opener)
            }}
          />
        </Row>

        {EDITABLE_TRACKS.map((track) => (
          <Row key={track} label={timelineRowLabel(track)} contentWidthPx={contentWidthPx}>
            {renderTrack(track)}
          </Row>
        ))}

        {playheadSec !== null && (
          /**
           * 再生ヘッド。行をまたいで 1 本引く。ラベル列（w-44 = 11rem）の右が時間軸の 0 秒。
           * `pointer-events-none` で、下の帯の操作を邪魔しない。
           */
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-danger"
            style={{
              left: `calc(11rem + ${String(playheadLeftPx(playheadSec, durationSec, pxPerSec))}px)`,
            }}
          />
        )}
        {overlay}
      </div>
    </div>
  )
}
