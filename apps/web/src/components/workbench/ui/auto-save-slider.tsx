'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { describeForPerson } from '@/lib/api-error'
import { FieldRow } from '@/components/workbench/ui/section'

type Status =
  | { readonly kind: 'idle' | 'saving' | 'saved' }
  | { readonly kind: 'error'; readonly message: string }

/** 矢印キーで動かしたとき、打鍵が止まってから保存するまでの間（ms）。 */
export const SLIDER_KEY_IDLE_MS = 400

/**
 * つまみ（エフェクトの強さなど。ADR-0050）。**離した時点で保存する。**
 * 動かしている間は値の表示だけを変える（毎回保存すると 1 回の操作で何十回も書く。`AutoSaveColor` と同じ）。
 *
 * - 指・マウス: 離したら保存。矢印キー: 打鍵が `SLIDER_KEY_IDLE_MS` 止まったら保存。欄を離れたら待たずに保存
 * - **保存は 1 本の口（`commit`）だけ。** 送った値と同じなら送らない（離す・欄を離れるが重なっても 2 回書かない）
 * - **保存中も欄を止めない。** 止めると矢印キーの続きが効かなくなった（2026-10-17 のレビュー）
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
  const draftRef = useRef(value)
  /** 最後に送った（または保存済みの）値。同じ値を 2 回送らない。 */
  const sentRef = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 保存済みの値が外で変わったら写す。**まだ送っていない手元の値があれば上書きしない**
  // （保存の返事が届く間にも矢印キーで動かせる。返事で手元の値を戻すと、押した分が消える）。
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    const pending = draftRef.current !== sentRef.current
    sentRef.current = value
    if (!pending) {
      draftRef.current = value
      setDraft(value)
    }
  }

  const clearTimer = (): void => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clearTimer, [])

  const commit = (): void => {
    clearTimer()
    const next = draftRef.current
    if (next === sentRef.current) return
    sentRef.current = next
    setStatus({ kind: 'saving' })
    onSave(next)
      .then(() => {
        setStatus({ kind: 'saved' })
      })
      .catch((cause: unknown) => {
        sentRef.current = value
        draftRef.current = value
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
          disabled={disabled}
          aria-valuetext={format(draft)}
          aria-describedby={`${id}-status`}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value)
            draftRef.current = next
            setDraft(next)
          }}
          onPointerUp={commit}
          onKeyUp={() => {
            clearTimer()
            timer.current = setTimeout(commit, SLIDER_KEY_IDLE_MS)
          }}
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
