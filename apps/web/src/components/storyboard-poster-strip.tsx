'use client'

import type { Shot, ShotId } from '@ixa/domain'
import { ShotPoster } from '@/components/shot-poster'
import { formatClock, formatDuration } from '@/lib/format-time'
import { posterViewFor, type ShotPosterMap } from '@/lib/shot-posters'

export type StoryboardPosterStripProps = {
  readonly shots: readonly Shot[]
  readonly posters: ShotPosterMap
  readonly selectedShotId: ShotId | null
  readonly onSelect: (shotId: ShotId) => void
}

/** 絵を主語にした Shot の帯。鎖は「この Shot が前から続く」を境界上に描く。 */
export const StoryboardPosterStrip = ({
  shots,
  posters,
  selectedShotId,
  onSelect,
}: StoryboardPosterStripProps) => (
  <div className="h-full overflow-auto bg-bg p-3">
    <div className="flex min-w-max items-stretch gap-0" role="list" aria-label="Shot のポスター帯">
      {shots.map((shot, index) => {
        const poster = posterViewFor(posters, shot.id)
        const connected = index > 0 && shot.continuityMode === 'previous_shot'
        const selected = shot.id === selectedShotId
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
                  : 'border-line bg-surface hover:border-line-strong'
              }`}
              aria-pressed={selected}
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
              <span className="mt-1 line-clamp-2 block min-h-10 text-xs text-muted">
                {shot.description.trim() === '' ? '説明はまだありません' : shot.description}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  </div>
)
