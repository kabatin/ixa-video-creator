'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * 行の「その他の操作」をしまう小さなメニュー。
 *
 * **消す操作を、よく使う操作の隣に置かない。** Shot 一覧では「Take を見る」の
 * すぐ下に赤い削除ボタンが並んでおり、制作者から「近すぎて怖い」と報告があった
 * （2026-09-18）。確認を挟んであっても、**押し間違えた次の一手で消える**位置に
 * 置くべきではない。一手ぶん遠ざける。
 *
 * `<details>` で作るのは、開閉に JavaScript を要らなくするため。
 * `<summary>` は最初から焦点が当たり、Enter / Space で開く。
 */

export type RowMenuProps = {
  /** 何のメニューかを読み上げに伝える。行ごとに違う文にする。 */
  readonly label: string
  readonly children: ReactNode
}

export const RowMenu = ({ label, children }: RowMenuProps) => {
  const ref = useRef<HTMLDetailsElement>(null)

  /**
   * 外を触ったら閉じる。`<details>` は既定では開いたままで、
   * 行をいくつも開くと、どの行の操作なのかが分からなくなる。
   */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const element = ref.current
      if (element === null || !element.open) return
      if (event.target instanceof Node && element.contains(event.target)) return
      element.open = false
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label={label}
        className="inline-flex cursor-pointer select-none items-center rounded-md border border-line-strong px-2 py-1 text-sm text-muted marker:content-none hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        {/* 3 点は装飾。何のメニューかは aria-label が伝える。 */}
        <span aria-hidden>⋯</span>
      </summary>
      <div className="absolute right-0 z-10 mt-1 min-w-max rounded-md border border-line-strong bg-surface p-2 shadow-lg">
        {children}
      </div>
    </details>
  )
}
