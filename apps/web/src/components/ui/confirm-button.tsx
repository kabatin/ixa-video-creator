'use client'

import { useState, type ReactNode } from 'react'
import { Button, type ButtonSize } from '@/components/ui/button'
import { WORDING } from '@/lib/wording'

/**
 * 取り消せない操作に確認を挟むボタン。
 *
 * **`window.confirm` を使わない。** ブラウザ既定のダイアログは文面の整形ができず、
 * 何が消えるかを十分に書けない。また自動テストから扱いにくい。
 *
 * 押すと「本当に消すか」を同じ場所に出し、もう一度押して初めて実行する。
 * 以前は Look も識別画像も 1 クリックで消え、取り消す手段が無かった。
 */
export type ConfirmButtonProps = {
  /** 平常時の文言。`WORDING.delete` などを使う。 */
  readonly label: string
  /** 確認文。**何が消えるかと、戻せないことを書く。** */
  readonly message: string
  /** 確認後に押すボタンの文言。既定は平常時と同じ。 */
  readonly confirmLabel?: string
  readonly disabled?: boolean
  readonly size?: ButtonSize
  readonly onConfirm: () => void
  /** 確認中に添える補足。何が消えるかの一覧など。 */
  readonly children?: ReactNode
}

export const ConfirmButton = ({
  label,
  message,
  confirmLabel,
  disabled = false,
  size = 'md',
  onConfirm,
  children,
}: ConfirmButtonProps) => {
  const [asking, setAsking] = useState(false)

  if (!asking) {
    return (
      <Button
        tone="danger"
        size={size}
        disabled={disabled}
        onClick={() => {
          setAsking(true)
        }}
      >
        {label}
      </Button>
    )
  }

  return (
    <div role="alertdialog" aria-label={label} className="rounded-md border border-danger/40 bg-danger/10 p-3">
      <p className="text-sm text-danger">{message}</p>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          tone="danger"
          size={size}
          disabled={disabled}
          onClick={() => {
            setAsking(false)
            onConfirm()
          }}
        >
          {confirmLabel ?? label}
        </Button>
        <Button
          tone="secondary"
          size={size}
          onClick={() => {
            setAsking(false)
          }}
        >
          {WORDING.cancel}
        </Button>
      </div>
    </div>
  )
}
