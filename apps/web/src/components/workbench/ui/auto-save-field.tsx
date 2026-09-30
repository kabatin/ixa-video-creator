'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { describeForPerson } from '@/lib/api-error'
import { FieldRow, INPUT_CLASS, TEXTAREA_CLASS } from '@/components/workbench/ui/section'

/** 直前の値へ戻すボタンを出しておく時間（ms）。 */
export const REVERT_WINDOW_MS = 10_000

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved'; readonly previous: string }
  | { readonly kind: 'error'; readonly message: string }

export type AutoSaveFieldProps = {
  readonly label: string
  /** 見出しが同じ名前を言っているときだけ。ラベルは読み上げに残す（`FieldRow`）。 */
  readonly hideLabel?: boolean
  /** 保存済みの値。保存に成功すると親が新しい値を渡し直す。 */
  readonly value: string
  /** 確定した値を保存する。失敗は reject（理由を欄の横に出す）。 */
  readonly onSave: (next: string) => Promise<void>
  /** 送る前の検証。問題があれば理由を返す（保存しない）。 */
  readonly validate?: (next: string) => string | null
  readonly multiline?: boolean
  readonly placeholder?: string
  readonly disabled?: boolean
}

/**
 * 確定したら保存する欄（UI-WORKBENCH-2 §2 P4）。**「保存」ボタンを置かない。**
 *
 * - 確定 = 欄を離れる（blur）か Enter（複数行は ⌘Enter）。Esc で打ちかけを捨てる
 * - 横に「保存中」「✓」「理由」を出す。保存したら 10 秒だけ ↺（直前の値へ戻す）を出す
 * - 値が変わっていなければ送らない
 */
export const AutoSaveField = ({
  label,
  hideLabel = false,
  value,
  onSave,
  validate,
  multiline = false,
  placeholder,
  disabled = false,
}: AutoSaveFieldProps) => {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 保存済みの値が外で変わったら（別のパネルで直した・Shot を替えた）打ちかけを捨てる。
  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const save = async (next: string, previous: string): Promise<void> => {
    if (next === previous) return
    const problem = validate?.(next) ?? null
    if (problem !== null) {
      setState({ kind: 'error', message: problem })
      return
    }
    setState({ kind: 'saving' })
    try {
      await onSave(next)
      setState({ kind: 'saved', previous })
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        setState((current) => (current.kind === 'saved' ? { kind: 'idle' } : current))
      }, REVERT_WINDOW_MS)
    } catch (cause) {
      setState({ kind: 'error', message: `保存できませんでした: ${describeForPerson(cause)}` })
    }
  }

  const commit = (): void => {
    void save(draft, value)
  }

  const common = {
    id,
    value: draft,
    placeholder,
    disabled: disabled || state.kind === 'saving',
    'aria-invalid': state.kind === 'error',
    'aria-describedby': `${id}-status`,
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value)
      if (state.kind === 'error') setState({ kind: 'idle' })
    },
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDraft(value)
        setState({ kind: 'idle' })
        return
      }
      const submit = multiline
        ? event.key === 'Enter' && (event.metaKey || event.ctrlKey)
        : event.key === 'Enter'
      if (!submit) return
      event.preventDefault()
      commit()
    },
  }

  return (
    <FieldRow label={label} htmlFor={id} hideLabel={hideLabel}>
      {multiline ? (
        <textarea {...common} rows={3} className={TEXTAREA_CLASS} />
      ) : (
        <input {...common} type="text" className={INPUT_CLASS} />
      )}
      <p
        id={`${id}-status`}
        role={state.kind === 'error' ? 'alert' : 'status'}
        // 何も無いときは高さを取らない（欄の間が空きすぎた）。読み上げの口は残す。
        className={state.kind === 'idle' ? 'sr-only' : 'mt-0.5 flex items-center gap-2 text-xs'}
      >
        {state.kind === 'saving' && <span className="text-muted">保存中…</span>}
        {state.kind === 'saved' && (
          <>
            <span className="text-ok">✓ 保存しました</span>
            <button
              type="button"
              className="text-muted underline hover:text-text"
              onClick={() => {
                void save(state.previous, value)
              }}
            >
              ↺ 戻す
            </button>
          </>
        )}
        {state.kind === 'error' && <span className="text-danger">{state.message}</span>}
      </p>
    </FieldRow>
  )
}
