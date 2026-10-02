'use client'

import type { Shot, ShotId } from '@ixa/domain'
import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { AssetDropState } from '@/components/workbench/use-asset-drop'
import { ShotPoster } from '@/components/shot-poster'
import { formatSpan } from '@/lib/format-time'
import {
  shotStatusDotClassName,
  shotStatusLabel,
  hasNoTakeYet,
  isGeneratingStatus,
} from '@/lib/shot-display'
import { CANCEL_GENERATION_LABEL } from '@/lib/context-menus'
import { posterViewFor, type ShotPosterMap } from '@/lib/shot-posters'
import {
  alignmentByShotId,
  describeDrift,
  posterEdgeClass,
  type ShotBeatAlignmentView,
} from '@/lib/beat-alignment-view'
import { storyboardColumns } from '@/lib/storyboard-grid'
import type { ContextMenuTriggerProps } from '@/components/workbench/use-context-menu'

export type StoryboardGridProps = {
  readonly shots: readonly Shot[]
  readonly posters: ShotPosterMap
  readonly selectedShotId: ShotId | null
  readonly onSelect: (shotId: ShotId) => void
  /** 拍とのズレ。判定は `@ixa/domain` の `alignBoundary`。ここは色を付けるだけ。 */
  readonly alignments?: readonly ShotBeatAlignmentView[]
  /** ダブルクリック（Take 比較を開くなど。UI-WORKBENCH-2 §6）。 */
  readonly onOpen?: (shotId: ShotId) => void
  /**
   * 「Take を作る」を押した（Take がまだ無い Shot だけに出す）。渡さなければ出さない。
   * Shot を作った後に Take をどこで作るか迷った（制作者 2026-09-30）ので、カードから直接行けるようにする。
   */
  readonly onMakeTake?: (shotId: ShotId) => void
  /** 生成中の Shot の様子（`作成中 2:31 / 約 4 分`）。分からなければ null（状態の点だけ）。 */
  readonly activityOf?: (shotId: ShotId) => string | null
  /** 「生成をやめる」を押した（生成中の Shot だけに出す。確認は呼び出し側）。渡さなければ出さない。 */
  readonly onCancelGeneration?: (shot: Shot) => void
  /** 右クリック・長押し・Shift+F10 でその Shot のメニューを開く口。 */
  readonly contextMenu?: (shot: Shot) => ContextMenuTriggerProps
  /** ロケーションの名前（素材の共有状態から引く）。無ければ出さない。 */
  readonly locationName?: (shot: Shot) => string | null
  /** ツリーの素材をカードへ落として割り当てる口（PHASE 8.5）。 */
  readonly dropHandlers?: (shot: Shot) => {
    readonly onDragOver: (event: DragEvent<HTMLElement>) => void
    readonly onDragLeave: () => void
    readonly onDrop: (event: DragEvent<HTMLElement>) => void
  }
  readonly dropState?: (shotId: ShotId) => AssetDropState
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
  onOpen,
  onMakeTake,
  activityOf,
  onCancelGeneration,
  contextMenu,
  locationName,
  dropHandlers,
  dropState,
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
            <li key={shot.id} {...(dropHandlers?.(shot) ?? {})}>
              <button
                type="button"
                aria-pressed={selected}
                {...contextMenu?.(shot)}
                onClick={() => {
                  onSelect(shot.id)
                }}
                onDoubleClick={() => {
                  onOpen?.(shot.id)
                }}
                title={alignment === null ? undefined : describeDrift(alignment)}
                className={`block w-full rounded-md border bg-surface p-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
                  (dropState?.(shot.id) ?? 'idle') !== 'idle'
                    ? 'border-accent bg-accent/10 ring-2 ring-accent ring-offset-2 ring-offset-bg'
                    : selected
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
                    pending={poster.pending}
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
                {locationName?.(shot) != null && (
                  <span className="block truncate text-xs text-muted">{`⌂ ${locationName(shot) ?? ''}`}</span>
                )}
              </button>
              {activityOf?.(shot.id) != null && (
                <p role="status" className="mt-1 truncate px-1 text-xs tabular-nums text-info">
                  {activityOf(shot.id)}
                </p>
              )}
              {onCancelGeneration !== undefined && isGeneratingStatus(shot.status) && (
                <button
                  type="button"
                  aria-label={`${shot.code} の${CANCEL_GENERATION_LABEL}`}
                  onClick={() => {
                    onCancelGeneration(shot)
                  }}
                  className="mt-1 w-full rounded border border-line px-2 py-0.5 text-xs text-muted hover:border-danger hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {CANCEL_GENERATION_LABEL}
                </button>
              )}
              {onMakeTake !== undefined && hasNoTakeYet(shot.status) && (
                <button
                  type="button"
                  aria-label={`${shot.code} の Take を作る`}
                  onClick={() => {
                    onMakeTake(shot.id)
                  }}
                  className="mt-1 w-full rounded border border-dashed border-line-strong px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  ＋ Take を作る
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
