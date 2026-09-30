'use client'

import { useState } from 'react'
import { TextField } from '@/components/form/text-field'
import { Button } from '@/components/ui/button'
import {
  CUT_MARK_KEY_HELP,
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
import { WORDING } from '@/lib/wording'
import { HelpDisclosure } from '@/components/ui/help-disclosure'
import { useContextMenuTrigger, type ContextMenuTriggerProps, type MenuPoint } from '@/components/workbench/use-context-menu'

/**
 * 区切りからできるカットの一覧（P56-4）。**表示だけを持つ。**
 * 追加・削除・移動・吸着の判定はすべて `@/lib/cut-marks` の純粋関数にあり、
 * この部品はその結果を並べて、操作を親へ渡すだけ。
 *
 * **1 行 = 1 区切り**にしてある。カットは区切り 2 個で決まるので、行にカットの
 * 開始と尺を載せると最後の区切りだけ行が無くなり、**消すことも直すこともできなくなる**。
 * 最後の区切りには「ここでカットが終わる」と書いた行を出す。
 *
 * 削除に確認を挟まないのは、区切りが**同じ画面ですぐ置き直せる**ため。
 * 取り消せない削除にだけ確認と `danger` を使う規則（`ui/button.tsx`）に合わせてある。
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
  mark.snappedTo === null ? '吸着なし' : snapTargetLabel(mark.snappedTo)

type MarkRowProps = {
  readonly mark: CutMark
  readonly index: number
  readonly cutLabel: string
  readonly busy: boolean
  readonly selected: boolean
  readonly onSelect: (index: number) => void
  readonly onRemove: (index: number) => void
  readonly onMove: (index: number, atSec: number) => void
  readonly contextMenu?: ContextMenuTriggerProps
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
}: MarkRowProps) => {
  const [raw, setRaw] = useState(mark.atSec.toFixed(TIME_DECIMALS))
  const [error, setError] = useState<string | undefined>(undefined)

  const submit = (): void => {
    const parsed = parseSeconds(raw)
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    setError(undefined)
    onMove(index, parsed.value)
  }

  return (
    <li
      {...contextMenu}
      className={`flex flex-wrap items-end gap-3 border-t border-line py-3 ${
        selected ? 'bg-info/10' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => {
          onSelect(index)
        }}
        aria-pressed={selected}
        className="min-w-56 flex-1 text-left"
      >
        <p className="text-sm font-medium text-text">{cutLabel}</p>
        <p className="text-xs text-muted">{`区切り ${String(index + 1)} — ${formatClock(mark.atSec)}`}</p>
        <p className="text-xs text-muted">{`吸着先: ${snapLabel(mark)}`}</p>
      </button>

      <div className="w-32">
        <TextField
          id={`cut-mark-${String(index)}`}
          label="区切り（秒）"
          value={raw}
          disabled={busy}
          error={error}
          onChange={setRaw}
        />
      </div>

      <Button tone="primary" size="sm" disabled={busy} onClick={submit}>
        動かす
      </Button>
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          onRemove(index)
        }}
      >
        {`${WORDING.delete}（区切り）`}
      </Button>
    </li>
  )
}

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
        <p role="alert" className="mt-3 text-sm text-danger">
          区切りを読み込めていません。「1 個も無い」ではなく「分からない」状態です。
        </p>
      )
    case 'no_marks':
      return (
        <p role="status" className="mt-3 text-sm text-muted">
          {`区切りがまだ 1 個もありません。曲の頭と終わりも境界になるので、区切りを 1 個置けば 2 カットになります（1 カットは ${formatDuration(MIN_CUT_DURATION_SEC)} 以上）。`}
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
    if (cut !== undefined) {
      return `カット ${String(cut.index + 1)} — ${formatSpan(cut.startSec, cut.durationSec)}`
    }
    return (mark?.atSec ?? 0) < songDurationSec / 2
      ? `曲の頭として扱います（頭から ${formatDuration(MIN_CUT_DURATION_SEC)} 未満）`
      : `曲の終わりとして扱います（終わりまで ${formatDuration(MIN_CUT_DURATION_SEC)} 未満）`
  }

  return (
    <section className="border-t border-line pt-2">
      <h3 className="text-xs font-semibold text-muted">できるカット</h3>

      {rejection === null ? null : (
        <p role="alert" className="mt-3 text-sm text-danger">
          {rejection.message}
        </p>
      )}

      <EmptyNotice marks={marks} songDurationSec={songDurationSec} />

      {sorted === null || cuts.length === 0 ? null : (
        <>
          <p role="status" className="mt-3 text-sm text-text">
            {`区切り ${String(sorted.length)} 個 → カット ${String(cuts.length)} 個。曲の頭と終わりも境界にするので、頭から終わりまで隙間も重なりもできません。`}
          </p>
          {headCut !== undefined && headCut.startMark === null && (
            <p className="mt-2 text-sm text-text">
              {`カット 1 — ${formatSpan(headCut.startSec, headCut.durationSec)}（曲の頭から）`}
            </p>
          )}
          <ul className="mt-2">
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
        </>
      )}
    </section>
  )
}

/**
 * キーの割り当て表。**キーボードだけで最初から最後まで操作できることを画面で示す。**
 * 割り当ての正は `@/lib/cut-marks` の `resolveCutMarkCommand` で、ここは並べるだけ。
 */
export const CutMarkKeyHelp = () => (
  /* **既定では畳む。** 初めは要るが、慣れると縦を食うだけになる。 */
  <HelpDisclosure label="キーの割り当て">
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {CUT_MARK_KEY_HELP.map((entry) => (
        <div key={entry.keys} className="contents">
          <dt className="font-mono text-xs text-text">{entry.keys}</dt>
          <dd className="text-xs text-muted">{entry.description}</dd>
        </div>
      ))}
    </dl>
    <p className="mt-2 text-xs text-muted">文字を打っている間はこれらのキーは効きません。</p>
  </HelpDisclosure>
)
