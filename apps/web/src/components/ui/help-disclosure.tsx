'use client'

import { useId, useState, type ReactNode } from 'react'

/**
 * 説明を「?」の中へ畳む。
 *
 * **説明文が画面の面積を食い、毎回読まれるわけでもない。** キーの割り当て表や
 * 使い方の文は、初めての人には要るが、慣れた人には邪魔になる。
 * 既定では畳み、必要な人だけが開く。
 *
 * **中身を消すのではなく畳む。** 読み上げからも消えないよう `<details>` を使う
 * （`hidden` で消すと、キーボードだけで操作する人が説明へ辿り着けない）。
 */

export type HelpDisclosureProps = {
  /** 何の説明かを、開く前から分かる短い言葉で。読み上げにも使う。 */
  readonly label: string
  /** 既定で開いておく。初めて触る画面など、閉じていると困る場所だけ true にする。 */
  readonly defaultOpen?: boolean
  readonly children: ReactNode
}

export const HelpDisclosure = ({
  label,
  defaultOpen = false,
  children,
}: HelpDisclosureProps) => {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()

  return (
    <details
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open)
      }}
      className="rounded-md border border-line bg-surface-2/40"
    >
      <summary
        aria-controls={id}
        className="cursor-pointer select-none rounded-md px-3 py-1.5 text-xs text-muted marker:content-none hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        {/* 「?」は装飾。何の説明かは文字で必ず書く。記号だけでは何が開くか分からない。 */}
        <span aria-hidden className="mr-1">
          ?
        </span>
        {open ? `${label}を隠す` : label}
      </summary>
      <div id={id} className="border-t border-line px-3 py-2">
        {children}
      </div>
    </details>
  )
}
