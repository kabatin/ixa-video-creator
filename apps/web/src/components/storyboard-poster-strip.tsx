'use client'

import type { Shot, ShotId } from '@ixa/domain'
import { ShotPoster } from '@/components/shot-poster'
import { formatClock, formatDuration } from '@/lib/format-time'
import { posterViewFor, type ShotPosterMap } from '@/lib/shot-posters'
import {
  alignmentByShotId,
  beatAlignmentToneClass,
  describeDrift,
  posterEdgeClass,
  summarizeBeatAlignment,
  type BeatAlignmentSource,
  type ShotBeatAlignmentView,
} from '@/lib/beat-alignment-view'

export type StoryboardPosterStripProps = {
  readonly shots: readonly Shot[]
  readonly posters: ShotPosterMap
  readonly selectedShotId: ShotId | null
  readonly onSelect: (shotId: ShotId) => void
  /**
   * 拍とのズレ。**渡さなければ帯は従来どおり**（拍の色も 1 行も出さない）。
   * 判定は `@ixa/domain` の `alignBoundary` が持ち、ここは色と文を並べるだけ。
   */
  readonly beatAlignment?: {
    readonly source: BeatAlignmentSource
    readonly trackTitle: string | null
    readonly views: readonly ShotBeatAlignmentView[]
  }
}

/** 絵を主語にした Shot の帯。鎖は「この Shot が前から続く」を境界上に描く。 */
export const StoryboardPosterStrip = ({
  shots,
  posters,
  selectedShotId,
  onSelect,
  beatAlignment,
}: StoryboardPosterStripProps) => {
  const alignments = beatAlignment === undefined ? null : alignmentByShotId(beatAlignment.views)
  const summary =
    beatAlignment === undefined
      ? null
      : summarizeBeatAlignment({
          source: beatAlignment.source,
          trackTitle: beatAlignment.trackTitle,
          views: beatAlignment.views,
        })

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      {summary !== null && (
        /* **色だけでは全体像が掴めない。** 何件が外れているかを必ず文でも出す。 */
        <p className={`px-3 pt-2 text-xs ${beatAlignmentToneClass(summary.tone)}`}>
          {summary.text}
        </p>
      )}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-3">
        <div
          className="flex min-w-max items-stretch gap-0"
          role="list"
          aria-label="Shot のポスター帯"
        >
          {shots.map((shot, index) => {
            const poster = posterViewFor(posters, shot.id)
            const connected = index > 0 && shot.continuityMode === 'previous_shot'
            const selected = shot.id === selectedShotId
            const alignment = alignments?.get(shot.id) ?? null
            /**
             * 左の辺だけを塗るので、**4 辺をまとめて塗り替えるホバーとは同時に出せない。**
             * ホバーの規則の方が後に効き、指を乗せた瞬間だけ拍の色が消える。
             * 色が付いているカードでは、縁のホバーを外す方を選ぶ。
             */
            const edge = posterEdgeClass(alignment?.alignment ?? null)
            return (
              <div key={shot.id} className="flex items-center" role="listitem">
                {index > 0 && (
                  <div
                    className={`flex w-8 items-center justify-center text-lg ${connected ? 'text-accent' : 'text-faint'}`}
                    title={connected ? '前の Shot から画を繋ぐ' : '独立したカット'}
                    aria-label={connected ? '前の Shot と接続' : '前の Shot とは独立'}
                  >
                    {connected ? '●━●' : '· ·'}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onSelect(shot.id)
                  }}
                  className={`w-56 rounded-lg border p-2 text-left transition ${
                    selected
                      ? 'border-accent bg-accent-soft/10 ring-1 ring-accent'
                      : `border-line bg-surface ${edge === '' ? 'hover:border-line-strong' : 'hover:ring-1 hover:ring-line-strong'}`
                  } ${edge}`}
                  aria-pressed={selected}
                  title={alignment === null ? undefined : describeDrift(alignment)}
                >
                  <ShotPoster
                    url={poster.url}
                    reason={poster.reason}
                    alt={`${shot.code} のサムネイル`}
                    size="card"
                  />
                  <span className="mt-2 flex items-baseline justify-between gap-2">
                    <strong className="text-sm text-text">{shot.code}</strong>
                    <span className="text-xs tabular-nums text-muted">
                      {formatClock(shot.startSec)} / {formatDuration(shot.durationSec)}
                    </span>
                  </span>
                  <span
                    className="mt-1 line-clamp-2 block h-10 overflow-hidden text-ellipsis text-xs text-muted"
                    title={shot.description.trim() === '' ? undefined : shot.description}
                  >
                    {shot.description.trim() === '' ? '説明はまだありません' : shot.description}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
