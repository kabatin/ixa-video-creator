'use client'

import { useState } from 'react'
import { FieldError } from '@/components/form/field-error'
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
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {hint !== undefined && <p className="mt-1 text-xs text-slate-500">{hint}</p>}

      <ul className="mt-2 flex flex-wrap gap-2">
        {values.map((value, index) => (
          <li
            key={value}
            className="flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm text-slate-800"
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
              className="rounded-full px-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed"
            >
              ×
            </button>
          </li>
        ))}
        {values.length === 0 && <li className="text-sm text-slate-400">未登録</li>}
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
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={commit}
          className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          追加
        </button>
      </div>

      <FieldError id={errorId} message={error ?? localError ?? undefined} />
    </div>
  )
}
