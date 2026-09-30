'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { describeForPerson } from '@/lib/api-error'
import { FieldRow, INPUT_CLASS } from '@/components/workbench/ui/section'

type Status =
  | { readonly kind: 'idle' | 'saving' | 'saved' }
  | { readonly kind: 'error'; readonly message: string }

const StatusLine = ({ id, status }: { readonly id: string; readonly status: Status }) => (
  <p
    id={id}
    role={status.kind === 'error' ? 'alert' : 'status'}
    className={status.kind === 'idle' ? 'sr-only' : 'mt-0.5 text-xs'}
  >
    {status.kind === 'saving' && <span className="text-muted">保存中…</span>}
    {status.kind === 'saved' && <span className="text-ok">✓ 保存しました</span>}
    {status.kind === 'error' && <span className="text-danger">{status.message}</span>}
  </p>
)

const useSaver = (onSave: (next: string) => Promise<void>) => {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const save = (next: string): void => {
    setStatus({ kind: 'saving' })
    onSave(next)
      .then(() => {
        setStatus({ kind: 'saved' })
      })
      .catch((cause: unknown) => {
        setStatus({ kind: 'error', message: `保存できませんでした: ${describeForPerson(cause)}` })
      })
  }
  return { status, save }
}

/** 選んだ時点で保存する選択欄（UI-WORKBENCH-2 §2 P4）。保存ボタンを置かない。 */
export const AutoSaveSelect = ({
  label,
  value,
  options,
  onSave,
  disabled = false,
}: {
  readonly label: string
  readonly value: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly onSave: (next: string) => Promise<void>
  readonly disabled?: boolean
}) => {
  const id = useId()
  const { status, save } = useSaver(onSave)
  return (
    <FieldRow label={label} htmlFor={id}>
      <select
        id={id}
        value={value}
        disabled={disabled || status.kind === 'saving'}
        aria-describedby={`${id}-status`}
        onChange={(event) => {
          save(event.target.value)
        }}
        className={INPUT_CLASS}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <StatusLine id={`${id}-status`} status={status} />
    </FieldRow>
  )
}

/** 押した時点で保存するチェック。 */
export const AutoSaveCheckbox = ({
  label,
  checked,
  onSave,
  disabled = false,
  hint,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onSave: (next: boolean) => Promise<void>
  readonly disabled?: boolean
  readonly hint?: string
}) => {
  const id = useId()
  const { status, save } = useSaver((next) => onSave(next === 'true'))
  return (
    <div>
      <label htmlFor={id} className="flex items-center gap-2 text-sm text-text">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled || status.kind === 'saving'}
          onChange={(event) => {
            save(String(event.target.checked))
          }}
          className="h-3.5 w-3.5"
        />
        {label}
      </label>
      {hint !== undefined && <p className="ml-5 text-xs text-muted">{hint}</p>}
      <StatusLine id={`${id}-status`} status={status} />
    </div>
  )
}

/**
 * 色（ADR-0028）。**ピッカーを閉じた（確定した）時点で保存する。**
 * React の onChange は動かしている間ずっと呼ばれるので、そこで保存すると 1 回の操作で何十回も書く。
 * 確定はブラウザの `change` で拾う。保存する値は `#RRGGBB`（大文字）。
 */
export const AutoSaveColor = ({
  label,
  value,
  onSave,
  disabled = false,
}: {
  readonly label: string
  readonly value: string
  readonly onSave: (next: string) => Promise<void>
  readonly disabled?: boolean
}) => {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const { status, save } = useSaver(onSave)
  const saveRef = useRef(save)
  saveRef.current = save
  const [draft, setDraft] = useState(value.toLowerCase())
  useEffect(() => {
    setDraft(value.toLowerCase())
  }, [value])
  // 描いたその場で付ける（`useEffect` だと DOM に入ってから付くまでに隙間があり、そこで確定した色を落としていた）。
  useLayoutEffect(() => {
    const element = input.current
    if (element === null) return undefined
    const commit = (): void => {
      saveRef.current(element.value.toUpperCase())
    }
    element.addEventListener('change', commit)
    return () => {
      element.removeEventListener('change', commit)
    }
  }, [])
  return (
    <FieldRow label={label} htmlFor={id}>
      <input
        ref={input}
        id={id}
        type="color"
        value={draft}
        disabled={disabled || status.kind === 'saving'}
        aria-describedby={`${id}-status`}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        className="h-7 w-14 cursor-pointer rounded border border-line-strong bg-bg"
      />
      <StatusLine id={`${id}-status`} status={status} />
    </FieldRow>
  )
}
