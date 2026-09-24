'use client'

import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * 待っているあいだ操作を止める進捗ダイアログ。
 *
 * **押したのに何も起きないように見える**のを無くすために置く。実際に 2 回踏んだ。
 *
 * - 曲を入れると解析が自動で始まるのに、画面は「まだ解析されていません・解析を実行」の
 *   ままだった。すでに走っているものを、もう一度押させる形になっていた
 * - 一括生成は確認がその場のボタンと入れ替わる形で、密なパネルの下のほうだと気づけない。
 *   押したつもりで何も起きていないと読み、しばらく気づかなかった
 *
 * 終わるまで**手を止める**のが正しい場面でだけ使う。裏で進んでよい仕事には使わない
 * （書き出しは閉じてもステータスバーで追える形にしてある）。
 */

export type ProgressDialogProps = {
  readonly open: boolean
  readonly title: string
  /** いま何をしているか。1 行。実装の言葉を使わない。 */
  readonly message: string
  /**
   * 進み具合（0〜1）。**分からないときは `null`。**
   * 偽の割合を出さない。null のときは「動いている」ことだけを見せる。
   */
  readonly value: number | null
  /** 失敗したときの理由。出ているあいだは閉じられる。 */
  readonly error?: string | null
  /** 閉じる口。`error` があるとき、または `onCancel` を渡したときだけ出す。 */
  readonly onClose?: () => void
  readonly closeLabel?: string
  readonly children?: ReactNode
}

export const ProgressDialog = ({
  open,
  title,
  message,
  value,
  error = null,
  onClose,
  closeLabel = '閉じる',
  children,
}: ProgressDialogProps) => {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const closable = error !== null && onClose !== undefined

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (open && !dialog.open) {
      // jsdom など showModal を持たない環境では属性だけ立てる。
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

  /**
   * **Esc で閉じさせない。** 待っている仕事は Esc では止まらないので、
   * 閉じられると「止めた」と誤解する。失敗したときだけ閉じる口を出す。
   */
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    const onCancel = (event: Event): void => {
      if (!closable) event.preventDefault()
      else onClose?.()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => {
      dialog.removeEventListener('cancel', onCancel)
    }
  }, [closable, onClose])

  const percent = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100)

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="workbench-dialog w-[min(92vw,460px)] rounded-lg border border-line bg-surface p-0 text-text shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent === null ? {} : { 'aria-valuenow': percent })}
          aria-valuetext={percent === null ? '進み具合は分かりません' : `${String(percent)}%`}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
        >
          {percent === null ? (
            // 割合が分からないときは、動いていることだけを見せる。数字を作らない。
            <span className="block h-full w-1/3 animate-pulse rounded-full bg-accent" />
          ) : (
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${String(percent)}%` }}
            />
          )}
        </div>

        <p role="status" className="text-sm text-muted">
          {percent === null ? message : `${message}（${String(percent)}%）`}
        </p>

        {children}

        {error !== null && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        {closable && (
          <div className="flex justify-end">
            <Button onClick={onClose}>{closeLabel}</Button>
          </div>
        )}
      </div>
    </dialog>
  )
}
