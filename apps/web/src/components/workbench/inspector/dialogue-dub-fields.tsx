'use client'

import type { DialogueDub, DubLineSpanSuggestion } from '@ixa/domain'
import { useEffect, useId, useState } from 'react'
import { INPUT_CLASS } from '@/components/workbench/ui/section'
import {
  DUB_FIELD_LABELS,
  dubFieldText,
  editDubField,
  editDubFlag,
  hasDubSpec,
  spanLabel,
  withSuggestedSpan,
  type DubEdit,
  type DubField,
} from '@/lib/dub-view'

const PLACEHOLDERS: Readonly<Record<DubField, string>> = {
  style: '小声でささやくように',
  placeAtSec: '0:01.20',
  fitSec: '1.20s',
  cutSec: '0.80s',
  levelDb: '-9.5',
  startSec: '0:00.40',
  endSec: '0:01.60',
}

const HINTS: Partial<Record<DubField, string>> = {
  placeAtSec: '口に合わせず、この時刻から話させます（画面外の声など）',
  fitSec: '長いときだけ縮めます',
  cutSec: '縮めずに切ります（最後をフェード）',
  levelDb: '元の声と同じ大きさにしてから足します。無ければキャラクターの既定',
}

/**
 * セリフの行の「差し替えの指定」（ADR-0062）。開いたときだけ欄を出す。欄を離れたとき・チェックを替えたときに保存する。
 * 規則に合わない値は保存せず、理由を出す（規則は domain の `DialogueDub`）。
 */
export const DialogueDubFields = ({
  label,
  index,
  dub,
  otherLines,
  suggestion,
  disabled,
  onChange,
}: {
  /** 「1 行目」など（欄の名前に使う）。 */
  readonly label: string
  readonly index: number
  readonly dub: DialogueDub | undefined
  /** 音量を合わせる行の選択肢（足す行でない、ほかの行）。 */
  readonly otherLines: readonly { readonly index: number; readonly text: string }[]
  /** 前の差し替えが止まったときの、この行の区間の案。 */
  readonly suggestion: DubLineSpanSuggestion | null
  readonly disabled: boolean
  readonly onChange: (dub: DialogueDub | undefined) => void
}) => {
  const [error, setError] = useState<string | null>(null)
  const apply = (edit: DubEdit): void => {
    if (!edit.ok) {
      setError(edit.message)
      return
    }
    setError(null)
    onChange(edit.dub)
  }
  const field = (name: DubField) => (
    <DubTextField
      key={name}
      lineLabel={label}
      field={name}
      value={dubFieldText(dub, name)}
      disabled={disabled}
      onCommit={(raw) => {
        apply(editDubField(dub, name, raw))
      }}
    />
  )
  const added = dub?.added === true
  const manualSpanMissing = dub?.startSec === undefined
  return (
    <details open={suggestion !== null && manualSpanMissing ? true : undefined} className="text-xs">
      <summary className="cursor-pointer text-muted hover:text-text">
        差し替えの指定{hasDubSpec(dub) ? '（あり）' : ''}
      </summary>
      <div className="mt-1 space-y-1">
        {field('style')}
        {field('placeAtSec')}
        {field('fitSec')}
        {field('cutSec')}
        {field('levelDb')}
        <label className="flex items-center gap-1 text-muted">
          <input
            type="checkbox"
            checked={dub?.keepOriginal === true}
            disabled={disabled}
            onChange={(event) => {
              apply(editDubFlag(dub, { keepOriginal: event.target.checked }))
            }}
          />
          元の声のまま
        </label>
        <label className="flex items-center gap-1 text-muted">
          <input
            type="checkbox"
            checked={added}
            disabled={disabled}
            onChange={(event) => {
              apply(editDubFlag(dub, { added: event.target.checked }))
            }}
          />
          足す行（元の Take では誰も話していない所に足す。置く時刻が要ります）
        </label>
        {added && (
          <label className="flex items-center gap-1 text-muted">
            音量を合わせる行
            <select
              aria-label={`${label}の音量を合わせる行`}
              value={dub?.levelLikeIndex === undefined ? '' : String(dub.levelLikeIndex)}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value
                apply(editDubFlag(dub, { levelLikeIndex: value === '' ? undefined : Number(value) }))
              }}
              className={INPUT_CLASS}
            >
              <option value="">選ばない</option>
              {otherLines
                .filter((line) => line.index !== index)
                .map((line) => (
                  <option key={line.index} value={String(line.index)}>
                    {`${String(line.index + 1)} 行目: ${line.text}`}
                  </option>
                ))}
            </select>
          </label>
        )}
        {!added && (
          <div className="space-y-1">
            <p className="text-muted">手の区間（元の声の区間から決まらないときだけ）</p>
            {field('startSec')}
            {field('endSec')}
          </div>
        )}
        {suggestion !== null && manualSpanMissing && !added && (
          <div role="status" className="flex flex-wrap items-center gap-2 text-warn">
            <span>行の区間の案: {spanLabel(suggestion)}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                apply(withSuggestedSpan(dub, suggestion))
              }}
              className="rounded border border-line px-1 text-text hover:bg-surface-2 disabled:opacity-40"
            >
              案を入れる
            </button>
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </details>
  )
}

const DubTextField = ({
  lineLabel,
  field,
  value,
  disabled,
  onCommit,
}: {
  readonly lineLabel: string
  readonly field: DubField
  readonly value: string
  readonly disabled: boolean
  readonly onCommit: (raw: string) => void
}) => {
  const id = useId()
  const [text, setText] = useState(value)
  // 保存した値（または外で直した値）が変わったら写す。
  useEffect(() => {
    setText(value)
  }, [value])
  const hint = HINTS[field]
  return (
    <div>
      <label htmlFor={id} className="text-muted">
        {DUB_FIELD_LABELS[field]}
      </label>
      <input
        id={id}
        aria-label={`${lineLabel}の${DUB_FIELD_LABELS[field]}`}
        value={text}
        placeholder={PLACEHOLDERS[field]}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value)
        }}
        onBlur={() => {
          if (text !== value) onCommit(text)
        }}
        className={INPUT_CLASS}
      />
      {hint !== undefined && <p className="text-muted">{hint}</p>}
    </div>
  )
}
