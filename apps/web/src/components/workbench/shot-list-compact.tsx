'use client'

import type { Shot, ShotId } from '@ixa/domain'
import { useEffect, useRef } from 'react'
import type { DragEvent, MouseEvent } from 'react'
import { ShotPoster } from '@/components/shot-poster'
import type { AssetDropState } from '@/components/workbench/use-asset-drop'
import {
  alignmentCellText,
  alignmentTextClass,
  describeDrift,
  type ShotBeatAlignmentView,
} from '@/lib/beat-alignment-view'
import { formatDuration } from '@/lib/format-time'
import { shotStatusClassName, shotStatusLabel } from '@/lib/shot-display'
import type { HeaderCheckboxState, ShotSelection } from '@/lib/shot-bulk'
import type { ShotSortKey, SortDirection } from '@/lib/shot-list-view'
import { posterViewFor, type ShotPosterMap } from '@/lib/shot-posters'
import type { ContextMenuTriggerProps } from '@/components/workbench/use-context-menu'

export type ShotListCompactProps = {
  readonly shots: readonly Shot[]
  readonly posters: ShotPosterMap
  readonly selectedShotId: ShotId | null
  readonly checked: ShotSelection
  readonly headerState: HeaderCheckboxState
  readonly busy: boolean
  readonly sort: { readonly key: ShotSortKey; readonly direction: SortDirection }
  readonly onSort: (key: ShotSortKey) => void
  readonly onSelect: (shotId: ShotId) => void
  /** `range` は Shift で押したとき（起点からここまでをまとめてチェック）。 */
  readonly onToggle: (shotId: ShotId, range: boolean) => void
  readonly onToggleAll: () => void
  /** ツリーの素材を行へ落として割り当てる口（PHASE 8.5）。 */
  readonly dropHandlers?: (shot: Shot) => {
    readonly onDragOver: (event: DragEvent<HTMLElement>) => void
    readonly onDragLeave: () => void
    readonly onDrop: (event: DragEvent<HTMLElement>) => void
  }
  readonly dropState?: (shotId: ShotId) => AssetDropState
  /** 時間順での番号（1 始まり）。並べ替えても番号は Shot に付いたまま。 */
  readonly numberOf: (shotId: ShotId) => number
  /**
   * 拍とのズレ。**どれが・どれだけズレているかは一覧でしか見比べられない。**
   * 集計の 1 行（「27 件中 16 件が外れています」）だけでは、直す先が分からなかった。
   * 拍が分かっていないときは空の Map を渡す（列ごと出さない）。
   */
  readonly alignmentOf: (shotId: ShotId) => ShotBeatAlignmentView | undefined
  /** 拍の列を出すか。楽曲や解析が無いときは false。 */
  readonly showBeat: boolean
  /** 生成中の Shot の様子（`作成中 2:31 / 約 4 分`）。分からなければ null（「生成中」だけ出す）。 */
  readonly activityOf?: (shotId: ShotId) => string | null
  /** 右クリック・長押し・Shift+F10 でその Shot のメニューを開く口。 */
  readonly contextMenu?: (shot: Shot) => ContextMenuTriggerProps
}

const CELL = 'px-1.5 align-middle'

const SORT_LABELS: Readonly<Record<ShotSortKey, string>> = {
  start: '#',
  duration: '尺',
  status: '状態',
}

/**
 * 右ペインの Shot 一覧（UI-WORKBENCH-2 §7）。
 *
 * - **行全体を押せる**（コードの文字だけが押せた）。Shift + チェックで範囲、⌘ + 行でチェックを足す
 * - 状態は**文字の小さなバッジ**（点だけでは「レビュー待ち」と「生成可能」の見分けが付かなかった）
 * - 見出しを押して並べ替え。素材をツリーから行へ落とすと割り当てる
 */
export const ShotListCompact = ({
  shots,
  posters,
  selectedShotId,
  checked,
  headerState,
  busy,
  sort,
  onSort,
  onSelect,
  onToggle,
  onToggleAll,
  dropHandlers,
  dropState,
  numberOf,
  alignmentOf,
  showBeat,
  activityOf,
  contextMenu,
}: ShotListCompactProps) => {
  const headerRef = useRef<HTMLInputElement>(null)

  /** 一部だけ選ばれている状態は属性では書けない。DOM のプロパティで出す。 */
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = headerState === 'partial'
  }, [headerState])

  const sortHeader = (key: ShotSortKey, align: 'left' | 'right' = 'left') => (
    <th
      scope="col"
      className={`${CELL} ${align === 'right' ? 'text-right' : ''}`}
      aria-sort={
        sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
      }
    >
      <button
        type="button"
        onClick={() => onSort(key)}
        className="inline-flex h-6 items-center gap-0.5 hover:text-text"
      >
        {SORT_LABELS[key]}
        <span aria-hidden className="text-xs">
          {sort.key === key ? (sort.direction === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  )

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, shot: Shot): void => {
    // チェックボックスやボタンの上の押下は、その部品に任せる。
    if (event.target instanceof HTMLElement && event.target.closest('input,button') !== null) return
    if (event.metaKey || event.ctrlKey) {
      onToggle(shot.id, false)
      return
    }
    onSelect(shot.id)
  }

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
          {sortHeader('start')}
          <th scope="col" className={CELL}>
            <span className="sr-only">サムネイル</span>
          </th>
          <th scope="col" className={CELL}>
            コード
          </th>
          {sortHeader('duration', 'right')}
          {showBeat && (
            <th scope="col" className={CELL} title="Shot の頭が拍に乗っているか">
              拍
            </th>
          )}
          {sortHeader('status')}
        </tr>
      </thead>
      <tbody>
        {shots.map((shot) => {
          const selected = shot.id === selectedShotId
          const poster = posterViewFor(posters, shot.id)
          const drop = dropState?.(shot.id) ?? 'idle'
          return (
            <tr
              key={shot.id}
              aria-selected={selected}
              {...contextMenu?.(shot)}
              onClick={(event) => {
                onRowClick(event, shot)
              }}
              {...(dropHandlers?.(shot) ?? {})}
              className={`h-7 cursor-pointer border-t border-line ${
                drop !== 'idle'
                  ? 'bg-accent/25 outline outline-2 -outline-offset-2 outline-accent'
                  : selected
                    ? 'bg-accent/15'
                    : checked.has(shot.id)
                      ? 'bg-info/10'
                      : 'hover:bg-surface-2'
              }`}
            >
              <td className={CELL}>
                <input
                  type="checkbox"
                  checked={checked.has(shot.id)}
                  disabled={busy}
                  aria-label={`${shot.code} を一括操作の対象にする`}
                  // 既定の動き（チェックの切り替え）は止めない。止めるとブラウザが押す前の見た目に戻し、
                  // 次に描き直すまで古いチェックのまま見えていた（2026-09-30）。Shift は押した瞬間の値を使う。
                  onChange={(event) => {
                    const native = event.nativeEvent
                    onToggle(shot.id, native instanceof MouseEvent && native.shiftKey)
                  }}
                  className="h-3.5 w-3.5"
                />
              </td>
              <td className={`${CELL} tabular-nums text-muted`}>
                {String(numberOf(shot.id)).padStart(2, '0')}
              </td>
              <td className={`${CELL} w-10`}>
                <span className="relative block h-5 w-9">
                  <ShotPoster
                    url={poster.url}
                    reason={poster.reason}
                    alt={`${shot.code} のサムネイル`}
                    size="chip"
                    pending={poster.pending}
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
              {showBeat && (
                <td className={`${CELL} whitespace-nowrap tabular-nums`}>
                  {(() => {
                    const view = alignmentOf(shot.id)
                    if (view === undefined) return <span className="text-muted">—</span>
                    return (
                      <span className={alignmentTextClass(view.alignment)} title={describeDrift(view)}>
                        {alignmentCellText(view)}
                      </span>
                    )
                  })()}
                </td>
              )}
              <td className={CELL}>
                <span
                  className={`inline-block whitespace-nowrap rounded px-1 text-xs ring-1 ring-inset ${shotStatusClassName(shot.status)}`}
                >
                  {shotStatusLabel(shot.status)}
                </span>
                {activityOf?.(shot.id) != null && (
                  <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-muted">{activityOf(shot.id)}</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
