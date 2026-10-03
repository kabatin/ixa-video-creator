'use client'

import { useState, type KeyboardEvent } from 'react'
import {
  MIN_CUT_DURATION_SEC,
  buildCuts,
  describeCuts,
  sortMarks,
  type CutMark,
  type MarkRejection,
} from '@/lib/cut-marks'
import { TIME_DECIMALS, formatClock, formatDuration, formatSpan } from '@/lib/format-time'
import { parseSeconds } from '@/lib/timeline-display'
import { snapTargetLabel } from '@/lib/timeline-snap'
import { useContextMenuTrigger, type ContextMenuTriggerProps, type MenuPoint } from '@/components/workbench/use-context-menu'

/**
 * 区切りからできるカットの一覧（P56-4）。**表示だけを持つ。**
 * 追加・削除・移動・吸着の判定はすべて `@/lib/cut-marks` の純粋関数にあり、
 * この部品はその結果を並べて、操作を親へ渡すだけ。
 *
 * **1 行 = 1 区切り**にしてある。カットは区切り 2 個で決まるので、行にカットの
 * 開始と尺を載せると最後の区切りだけ行が無くなり、**消すことも直すこともできなくなる**。
 *
 * **詰めて、畳む**（制作者 2026-10-03「カット一覧が下にずらっと並ぶが、どれも似たような UI が並んでいるだけで縦幅取りすぎ」）。
 * 1 行は「カットと区間・時刻・✕」だけにし、既定は「区切り N 個 → カット M 個」の 1 行に畳む。区切りは波形の上でも見える。
 * 時刻は押すとその場で直せる（Enter で確定、Esc でやめる）。以前の「動かす」ボタン（主ボタン）はやめた。
 *
 * 削除に確認を挟まないのは、区切りが**同じ画面ですぐ置き直せる**ため。
 */

export type CutMarkListProps = {
  /** null は「読み込めていない」。区切り 0 個と混同させない。 */
  readonly marks: readonly CutMark[] | null
  /** 曲の尺。曲の頭と終わりも境界にするので要る。 */
  readonly songDurationSec: number
  readonly busy: boolean
  /** 選んでいる区切りの位置。未選択は -1。 */
  readonly selectedIndex: number
  readonly onSelect: (index: number) => void
  readonly onRemove: (index: number) => void
  readonly onMove: (index: number, atSec: number) => void
  /** 区切りの右クリック（長押し・Shift+F10）。渡さなければブラウザのメニューのまま。 */
  readonly onMarkContextMenu?: (index: number, at: MenuPoint, origin: HTMLElement) => void
  /** 直前の操作が断られた理由。断られていなければ null。 */
  readonly rejection: MarkRejection | null
}

const snapLabel = (mark: CutMark): string =>
  mark.snappedTo === null ? '吸着なし' : `吸着先: ${snapTargetLabel(mark.snappedTo)}`

/** 時刻。押すとその場で直せる（Enter で確定・Esc でやめる・外へ出たら確定）。 */
const MarkTime = ({
  mark,
  index,
  busy,
  onMove,
}: {
  readonly mark: CutMark
  readonly index: number
  readonly busy: boolean
  readonly onMove: (index: number, atSec: number) => void
}) => {
  const [raw, setRaw] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = `区切り ${String(index + 1)}`

  const commit = (): void => {
    if (raw === null) return
    const parsed = parseSeconds(raw)
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    setError(null)
    setRaw(null)
    onMove(index, parsed.value)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setRaw(null)
      setError(null)
    }
  }

  if (raw === null) {
    return (
      <button
        type="button"
        aria-label={`${name} の時刻を直す`}
        disabled={busy}
        onClick={() => {
          setRaw(mark.atSec.toFixed(TIME_DECIMALS))
        }}
        className="h-6 rounded px-1.5 tabular-nums text-text hover:bg-surface-2 disabled:text-muted"
      >
        {formatClock(mark.atSec)}
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <input
        aria-label={`${name} の時刻（秒）`}
        // 押した直後に打てるよう、開いたら焦点を移す（この欄は押したときだけ現れる）。
        autoFocus
        value={raw}
        onChange={(event) => {
          setRaw(event.target.value)
        }}
        onKeyDown={onKeyDown}
        onBlur={commit}
        aria-invalid={error !== null}
        className="h-6 w-20 rounded border border-line-strong bg-surface px-1 text-xs tabular-nums"
      />
      {error !== null && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  )
}

const MarkRow = ({
  mark,
  index,
  cutLabel,
  busy,
  selected,
  onSelect,
  onRemove,
  onMove,
  contextMenu,
}: {
  readonly mark: CutMark
  readonly index: number
  readonly cutLabel: string
  readonly busy: boolean
  readonly selected: boolean
  readonly onSelect: (index: number) => void
  readonly onRemove: (index: number) => void
  readonly onMove: (index: number, atSec: number) => void
  readonly contextMenu?: ContextMenuTriggerProps
}) => (
  <li
    {...contextMenu}
    className={`flex items-center gap-2 rounded px-1 text-xs ${selected ? 'bg-info/10' : ''}`}
  >
    <button
      type="button"
      onClick={() => {
        onSelect(index)
      }}
      aria-pressed={selected}
      title={snapLabel(mark)}
      className="h-6 min-w-0 flex-1 truncate text-left tabular-nums text-text"
    >
      {cutLabel}
    </button>
    <MarkTime mark={mark} index={index} busy={busy} onMove={onMove} />
    <button
      type="button"
      aria-label={`区切り ${String(index + 1)} を消す`}
      disabled={busy}
      onClick={() => {
        onRemove(index)
      }}
      className="h-6 w-6 rounded text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-50"
    >
      ✕
    </button>
  </li>
)

/** カットが 1 つもできない理由。**「無い」と「分からない」を必ず書き分ける。** */
const EmptyNotice = ({
  marks,
  songDurationSec,
}: {
  readonly marks: readonly CutMark[] | null
  readonly songDurationSec: number
}) => {
  const outcome = describeCuts(marks, songDurationSec)
  switch (outcome.state) {
    case 'unreadable':
      return (
        <p role="alert" className="text-sm text-danger">
          区切りを読み込めていません。「1 個も無い」ではなく「分からない」状態です。
        </p>
      )
    case 'no_marks':
      return (
        <p role="status" className="text-xs text-muted">
          {`区切りがまだありません。曲の頭と終わりも境界になるので、区切りを 1 個置けば 2 カットになります（1 カットは ${formatDuration(MIN_CUT_DURATION_SEC)} 以上）。`}
        </p>
      )
    case 'cuts':
      return null
  }
}

export const CutMarkList = ({
  marks,
  songDurationSec,
  busy,
  selectedIndex,
  onSelect,
  onRemove,
  onMove,
  onMarkContextMenu,
  rejection,
}: CutMarkListProps) => {
  const markMenu = useContextMenuTrigger<number>((index, at, origin) => {
    onMarkContextMenu?.(index, at, origin)
  })
  const sorted = marks === null ? null : sortMarks(marks)
  const cuts = sorted === null ? [] : buildCuts(sorted, songDurationSec)
  const headCut = cuts[0]

  /**
   * 区切りごとの見出し。**その区切りから始まるカット**を出す。
   * 端に近すぎて境界にならなかった区切りは、曲の頭・終わりとして扱ったことを言う。
   */
  const cutLabelAt = (index: number): string => {
    const mark = sorted?.[index]
    const cut = cuts.find((candidate) => candidate.startMark === mark)
    if (cut !== undefined) return `カット ${String(cut.index + 1)}  ${formatSpan(cut.startSec, cut.durationSec)}`
    return (mark?.atSec ?? 0) < songDurationSec / 2 ? '曲の頭として扱います' : '曲の終わりとして扱います'
  }

  return (
    <section aria-label="区切りの一覧" className="space-y-1">
      {rejection === null ? null : (
        <p role="alert" className="text-sm text-danger">
          {rejection.message}
        </p>
      )}

      <EmptyNotice marks={marks} songDurationSec={songDurationSec} />

      {sorted === null || cuts.length === 0 ? null : (
        <details className="rounded-md border border-line">
          <summary className="cursor-pointer px-2 py-1 text-xs text-text hover:bg-surface-2">
            {`区切り ${String(sorted.length)} 個 → カット ${String(cuts.length)} 個`}
          </summary>
          <div className="space-y-0.5 border-t border-line p-1">
            {headCut !== undefined && headCut.startMark === null && (
              <p className="px-1 text-xs tabular-nums text-muted">
                {`カット 1  ${formatSpan(headCut.startSec, headCut.durationSec)}（曲の頭から）`}
              </p>
            )}
            <ul className="space-y-0.5">
              {sorted.map((mark, index) => (
                <MarkRow
                  key={`${String(index)}-${mark.atSec.toFixed(4)}`}
                  mark={mark}
                  index={index}
                  cutLabel={cutLabelAt(index)}
                  busy={busy}
                  selected={index === selectedIndex}
                  onSelect={onSelect}
                  onRemove={onRemove}
                  onMove={onMove}
                  {...(onMarkContextMenu === undefined ? {} : { contextMenu: markMenu(index) })}
                />
              ))}
            </ul>
          </div>
        </details>
      )}
    </section>
  )
}
