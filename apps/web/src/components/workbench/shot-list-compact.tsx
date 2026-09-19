'use client'

import type { Shot, ShotId } from '@ixa/domain'
import { useEffect, useRef } from 'react'
import { ShotPoster } from '@/components/shot-poster'
import { formatDuration } from '@/lib/format-time'
import { shotStatusDotClassName, shotStatusLabel } from '@/lib/shot-display'
import type { HeaderCheckboxState, ShotSelection } from '@/lib/shot-bulk'
import { posterViewFor, type ShotPosterMap } from '@/lib/shot-posters'

export type ShotListCompactProps = {
  readonly shots: readonly Shot[]
  readonly posters: ShotPosterMap
  readonly selectedShotId: ShotId | null
  readonly checked: ShotSelection
  readonly headerState: HeaderCheckboxState
  readonly busy: boolean
  readonly onSelect: (shotId: ShotId) => void
  readonly onToggle: (shotId: ShotId) => void
  readonly onToggleAll: () => void
}

const CELL = 'px-1.5 align-middle'

/**
 * 右ペインの Shot 一覧（UI-WORKBENCH §3.1）。**列は 5 つ**（番号・絵・コード・尺・状態）＋チェック。
 * 320px に収まらない説明・mood・カメラはインスペクターで直す（§12）。
 *
 * 行を押すと選択（インスペクター・Take 比較・ストーリーボードが連動する）。
 * チェックは一括操作の対象で、選択とは別物。
 */
export const ShotListCompact = ({
  shots,
  posters,
  selectedShotId,
  checked,
  headerState,
  busy,
  onSelect,
  onToggle,
  onToggleAll,
}: ShotListCompactProps) => {
  const headerRef = useRef<HTMLInputElement>(null)

  /** 一部だけ選ばれている状態は属性では書けない。DOM のプロパティで出す。 */
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = headerState === 'partial'
  }, [headerState])

  return (
    <table className="w-full border-collapse text-left text-xs">
      <caption className="sr-only">Shot 一覧</caption>
      <thead className="sticky top-0 z-10 bg-surface-2 text-muted">
        <tr className="h-6">
          <th scope="col" className={CELL}>
            <input
              ref={headerRef}
              type="checkbox"
              checked={headerState === 'all'}
              disabled={busy || shots.length === 0}
              aria-label={
                headerState === 'all' ? 'すべての選択を解除' : '表示中の Shot をすべて選択'
              }
              onChange={onToggleAll}
              className="h-3.5 w-3.5"
            />
          </th>
          <th scope="col" className={CELL}>
            #
          </th>
          <th scope="col" className={CELL}>
            <span className="sr-only">サムネイル</span>
          </th>
          <th scope="col" className={CELL}>
            コード
          </th>
          <th scope="col" className={`${CELL} text-right`}>
            尺
          </th>
          <th scope="col" className={CELL}>
            <span className="sr-only">状態</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {shots.map((shot, index) => {
          const selected = shot.id === selectedShotId
          const poster = posterViewFor(posters, shot.id)
          return (
            <tr
              key={shot.id}
              aria-selected={selected}
              className={`h-6 border-t border-line ${selected ? 'bg-accent/15' : checked.has(shot.id) ? 'bg-info/10' : 'hover:bg-surface-2'}`}
            >
              <td className={CELL}>
                <input
                  type="checkbox"
                  checked={checked.has(shot.id)}
                  disabled={busy}
                  aria-label={`${shot.code} を一括操作の対象にする`}
                  onChange={() => {
                    onToggle(shot.id)
                  }}
                  className="h-3.5 w-3.5"
                />
              </td>
              <td className={`${CELL} tabular-nums text-muted`}>
                {String(index + 1).padStart(2, '0')}
              </td>
              <td className={`${CELL} w-10`}>
                <span className="relative block h-5 w-9">
                  <ShotPoster
                    url={poster.url}
                    reason={poster.reason}
                    alt={`${shot.code} のサムネイル`}
                    size="chip"
                  />
                </span>
              </td>
              <th scope="row" className={`${CELL} font-normal`}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onSelect(shot.id)
                  }}
                  className="min-h-6 w-full truncate text-left font-semibold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {shot.code}
                </button>
              </th>
              <td className={`${CELL} text-right tabular-nums text-muted`}>
                {formatDuration(shot.durationSec)}
              </td>
              <td className={CELL}>
                <span
                  role="img"
                  aria-label={shotStatusLabel(shot.status)}
                  title={shotStatusLabel(shot.status)}
                  className={`inline-block h-2 w-2 rounded-full ${shotStatusDotClassName(shot.status)}`}
                />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
