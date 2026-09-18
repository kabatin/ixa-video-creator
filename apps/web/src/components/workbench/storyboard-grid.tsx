'use client'

import type { Shot, ShotId } from '@ixa/domain'
import { useEffect, useRef, useState } from 'react'
import { ShotPoster } from '@/components/shot-poster'
import { formatSpan } from '@/lib/format-time'
import { shotStatusDotClassName, shotStatusLabel } from '@/lib/shot-display'
import { posterViewFor, type ShotPosterMap } from '@/lib/shot-posters'
import {
  alignmentByShotId,
  describeDrift,
  posterEdgeClass,
  type ShotBeatAlignmentView,
} from '@/lib/beat-alignment-view'
import { storyboardColumns } from '@/lib/storyboard-grid'

export type StoryboardGridProps = {
  readonly shots: readonly Shot[]
  readonly posters: ShotPosterMap
  readonly selectedShotId: ShotId | null
  readonly onSelect: (shotId: ShotId) => void
  /** 拍とのズレ。判定は `@ixa/domain` の `alignBoundary`。ここは色を付けるだけ。 */
  readonly alignments?: readonly ShotBeatAlignmentView[]
}

/**
 * 区画の幅を測る。**画面幅（matchMedia）ではない**（lessons L-025）。
 * 測れない環境（ResizeObserver が無い）では 1 列にしておく。
 */
const useRegionWidth = (): readonly [React.RefObject<HTMLDivElement | null>, number] => {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  return [ref, width]
}

/**
 * ストーリーボード（UI-WORKBENCH §5.3）。Shot のカードを**最大 3 列**で並べる。
 * 中央は絵を大きく見る場所。探すのは右の一覧に任せる（D6）。
 */
export const StoryboardGrid = ({
  shots,
  posters,
  selectedShotId,
  onSelect,
  alignments,
}: StoryboardGridProps) => {
  const [ref, width] = useRegionWidth()
  const columns = storyboardColumns(width)
  const byShot = alignments === undefined ? null : alignmentByShotId(alignments)

  return (
    <div ref={ref} className="w-full">
      <ul
        aria-label="ストーリーボード"
        data-columns={columns}
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }}
      >
        {shots.map((shot, index) => {
          const poster = posterViewFor(posters, shot.id)
          const selected = shot.id === selectedShotId
          const connected = index > 0 && shot.continuityMode === 'previous_shot'
          const alignment = byShot?.get(shot.id) ?? null
          const edge = posterEdgeClass(alignment?.alignment ?? null)
          const description = shot.description.trim()
          return (
            <li key={shot.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  onSelect(shot.id)
                }}
                title={alignment === null ? undefined : describeDrift(alignment)}
                className={`block w-full rounded-md border bg-surface p-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
                  selected
                    ? 'border-accent ring-2 ring-accent'
                    : // 拍の色は左の辺だけ。4 辺を塗り替えるホバーを重ねると、指を乗せた瞬間に色が消える。
                      `border-line ${edge === '' ? 'hover:border-line-strong' : 'hover:ring-1 hover:ring-line-strong'}`
                } ${edge}`}
              >
                <span className="relative block">
                  <ShotPoster
                    url={poster.url}
                    reason={poster.reason}
                    alt={`${shot.code} のサムネイル`}
                    size="card"
                  />
                  {/* 状態の点。色だけに頼らず、読み上げと title に名前を渡す。 */}
                  <span
                    role="img"
                    aria-label={shotStatusLabel(shot.status)}
                    title={shotStatusLabel(shot.status)}
                    className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${shotStatusDotClassName(shot.status)}`}
                  />
                </span>
                <span className="mt-1 flex items-baseline gap-2">
                  <strong className="text-sm text-text">{shot.code}</strong>
                  <span className="truncate text-xs tabular-nums text-muted">
                    {formatSpan(shot.startSec, shot.durationSec)}
                  </span>
                  {connected && (
                    <span
                      className="ml-auto text-xs text-accent"
                      title="前の Shot から画を繋ぐ"
                      aria-label="前の Shot と接続"
                    >
                      ⛓
                    </span>
                  )}
                </span>
                <span
                  className="block truncate text-xs text-muted"
                  title={description === '' ? undefined : description}
                >
                  {description === '' ? '説明はまだありません' : description}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
