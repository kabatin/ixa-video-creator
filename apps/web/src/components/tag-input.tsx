'use client'

import { useState } from 'react'
import { FieldError } from '@/components/form/field-error'
import {
  FIELD_CONTROL_CLASS,
  FIELD_HINT_CLASS,
  FIELD_LABEL_CLASS,
} from '@/components/form/field-styles'
import { Button } from '@/components/ui/button'
import { addTag, removeTagAt } from '@/lib/tag-input'

export type TagInputProps = {
  readonly id: string
  readonly label: string
  readonly values: readonly string[]
  readonly onChange: (values: readonly string[]) => void
  readonly hint?: string
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly error?: string
}

/** 削除ボタンは小さいので、枠と文字のコントラストを落とさない。slate-100 地に slate-600 で 6.92。 */
const REMOVE_BUTTON_CLASS =
  'rounded-full px-1.5 text-muted hover:bg-line hover:text-text ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-muted'

/**
 * 配列のプロンプト断片を 1 つずつ足し引きする入力。
 * カンマ区切りの 1 行入力にしないのは、後から特定の要素だけを消せなくなるため。
 */
export const TagInput = ({
  id,
  label,
  values,
  onChange,
  hint,
  placeholder,
  disabled = false,
  error,
}: TagInputProps) => {
  const [draft, setDraft] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const errorId = `${id}-error`

  const commit = (): void => {
    const result = addTag(values, draft)
    if (!result.ok) {
      setLocalError(result.reason)
      return
    }
    setLocalError(null)
    setDraft('')
    onChange(result.tags)
  }

  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL_CLASS}>
        {label}
      </label>
      {hint !== undefined && <p className={`mt-1 ${FIELD_HINT_CLASS}`}>{hint}</p>}

      <ul className="mt-2 flex flex-wrap gap-2">
        {values.map((value, index) => (
          <li
            key={value}
            className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm text-text"
          >
            <span>{value}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`${value} を削除`}
              onClick={() => {
                setLocalError(null)
                onChange(removeTagAt(values, index))
              }}
              className={REMOVE_BUTTON_CLASS}
            >
              ×
            </button>
          </li>
        ))}
        {values.length === 0 && <li className="text-sm text-muted">未登録</li>}
      </ul>

      <div className="mt-2 flex gap-2">
        <input
          id={id}
          name={id}
          type="text"
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error !== undefined || localError !== null}
          aria-describedby={error === undefined && localError === null ? undefined : errorId}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onKeyDown={(event) => {
            // フォーム全体の送信を誘発させない。Enter はこの入力の確定だけに使う。
            if (event.key !== 'Enter') return
            event.preventDefault()
            commit()
          }}
          className={FIELD_CONTROL_CLASS}
        />
        <div className="shrink-0">
          <Button tone="secondary" disabled={disabled} onClick={commit}>
            追加
          </Button>
        </div>
      </div>

      <FieldError id={errorId} message={error ?? localError ?? undefined} />
    </div>
  )
}
