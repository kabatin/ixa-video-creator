'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

export type WorkbenchDialogProps = {
  readonly open: boolean
  readonly title: string
  readonly onClose: () => void
  /**
   * 保存前の入力を守る（設定フォームが対象。UI-WORKBENCH §3.3）。
   * 真なら、中で何か入力したあとは**背景クリックでは閉じない**。Esc と閉じるボタンは効く。
   */
  readonly guardUnsaved?: boolean
  /** 画面をほぼ覆う大きさ（既定）か、小さな確認向けか。 */
  readonly size?: 'large' | 'medium'
  readonly children: ReactNode
}

const SIZES: Readonly<Record<NonNullable<WorkbenchDialogProps['size']>, string>> = {
  large: 'h-[92vh] w-[min(96vw,1400px)]',
  medium: 'max-h-[80vh] w-[min(92vw,640px)]',
}

/**
 * ワークベンチのダイアログの殻（UI-WORKBENCH §3.3）。**1 つだけ。** 中身は渡すだけ。
 *
 * ネイティブ `<dialog>` + `showModal()`。焦点の閉じ込め・Esc・背景のスクロール止めは
 * ブラウザが持つ。依存を足さない。背景のぼかしは `globals.css` の `.workbench-dialog::backdrop`。
 *
 * - 開くと焦点が中に入る（ブラウザが最初の押せるものへ送る）
 * - 閉じたら焦点を開いたところへ戻す。戻さないとキーボードの利用者が現在地を失う
 * - 開いている間もワークベンチは mount されたまま。選択と再生位置は残る
 */
export const WorkbenchDialog = ({
  open,
  title,
  onClose,
  guardUnsaved = false,
  size = 'large',
  children,
}: WorkbenchDialogProps) => {
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [touched, setTouched] = useState(false)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setTouched(false)
      // jsdom など showModal を持たない環境では属性だけ立てる（見た目の閉じ込めは無い）。
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      opener.current?.focus()
      opener.current = null
    }
  }, [open])

  /** Esc はブラウザが `cancel` を出す。勝手に閉じさせず、親の状態で閉じる。 */
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return undefined
    const onCancel = (event: Event): void => {
      event.preventDefault()
      onClose()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => {
      dialog.removeEventListener('cancel', onCancel)
    }
  }, [onClose])

  /** 背景（`::backdrop`）を押すと、クリックの的は `<dialog>` そのものになる。 */
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>): void => {
    if (event.target !== event.currentTarget) return
    if (guardUnsaved && touched) return
    onClose()
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={onBackdrop}
      onInput={() => {
        if (guardUnsaved) setTouched(true)
      }}
      className={`workbench-dialog m-auto overflow-hidden rounded-lg border border-line bg-surface p-0 text-text shadow-2xl ${SIZES[size]}`}
    >
      {open && (
        <div className="flex h-full max-h-[inherit] flex-col">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {guardUnsaved && touched && (
              <span className="text-xs text-warn">保存していない入力があります</span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={`${title}を閉じる`}
              className="ml-auto inline-flex h-7 min-w-7 items-center justify-center rounded px-2 text-sm text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            >
              閉じる
            </button>
          </header>
          <div className="relative min-h-0 flex-1 overflow-auto p-4">{children}</div>
        </div>
      )}
    </dialog>
  )
}
