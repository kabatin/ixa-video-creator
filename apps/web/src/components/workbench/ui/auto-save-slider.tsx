'use client'

import { useId, useState } from 'react'
import { describeForPerson } from '@/lib/api-error'
import { FieldRow } from '@/components/workbench/ui/section'

type Status =
  | { readonly kind: 'idle' | 'saving' | 'saved' }
  | { readonly kind: 'error'; readonly message: string }

/**
 * つまみ（エフェクトの強さなど。ADR-0050）。**離した時点で保存する。**
 * 動かしている間は値の表示だけを変える（毎回保存すると 1 回の操作で何十回も書く。`AutoSaveColor` と同じ）。
 * キーボードの矢印でも動かせ、そのときは打鍵を離した時点で保存する。
 */
export const AutoSaveSlider = ({
  label,
  value,
  min,
  max,
  step,
  format,
  onSave,
  disabled = false,
}: {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  /** 値の見せ方（割合・秒など）。px や生の秒を出さない。 */
  readonly format: (value: number) => string
  readonly onSave: (next: number) => Promise<void>
  readonly disabled?: boolean
}) => {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  // 保存済みの値が外で変わったら写す。描くときに比べる（`AutoSaveField` と同じ。effect だと出た直後の操作を戻す）。
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setDraft(value)
  }

  const commit = (): void => {
    if (draft === value) return
    setStatus({ kind: 'saving' })
    onSave(draft)
      .then(() => {
        setStatus({ kind: 'saved' })
      })
      .catch((cause: unknown) => {
        setDraft(value)
        setStatus({ kind: 'error', message: `保存できませんでした: ${describeForPerson(cause)}` })
      })
  }

  return (
    <FieldRow label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={draft}
          disabled={disabled || status.kind === 'saving'}
          aria-valuetext={format(draft)}
          aria-describedby={`${id}-status`}
          onChange={(event) => {
            setDraft(Number.parseFloat(event.target.value))
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="h-1 min-w-0 flex-1 accent-accent"
        />
        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-text">{format(draft)}</span>
      </div>
      <p
        id={`${id}-status`}
        role={status.kind === 'error' ? 'alert' : 'status'}
        className={status.kind === 'idle' ? 'sr-only' : 'mt-0.5 text-xs'}
      >
        {status.kind === 'saving' && <span className="text-muted">保存中…</span>}
        {status.kind === 'saved' && <span className="text-ok">✓ 保存しました</span>}
        {status.kind === 'error' && <span className="text-danger">{status.message}</span>}
      </p>
    </FieldRow>
  )
}
