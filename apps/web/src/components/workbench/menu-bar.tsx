'use client'

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { APP_NAME_ACCENT, APP_NAME_REST } from '@/lib/app-name'
import type { Menu, MenuItem } from '@/lib/menu-model'

export type MenuBarProps = {
  readonly menus: readonly Menu[]
  readonly onSelect: (item: MenuItem) => void
  /** 右端（作業モード・歯車・書き出し）。 */
  readonly trailing?: ReactNode
}

const wrap = (index: number, length: number): number => (index + length) % length

/**
 * メニューバー（UI-WORKBENCH §4）。WAI-ARIA の Menubar パターンを自作する（依存を足さない）。
 *
 * - ← → でメニュー間（開いていれば隣を開く）、↓ / Enter / Space で開いて先頭へ
 * - ↑ ↓ で項目、Enter / Space で実行、Esc で閉じて見出しへ戻る
 * - 無効な項目も焦点は当たる（`aria-disabled`）。押せない理由を読み上げで知れるように
 * - 見出しは roving tabindex。Tab 1 回でメニューバーに入り、もう 1 回で出る
 */
export const MenuBar = ({ menus, onSelect, trailing }: MenuBarProps) => {
  const [open, setOpen] = useState<number | null>(null)
  const [focusedTop, setFocusedTop] = useState(0)
  const topRefs = useRef<(HTMLButtonElement | null)[]>([])
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const barRef = useRef<HTMLDivElement>(null)

  /** 外を押したら閉じる。 */
  useEffect(() => {
    if (open === null) return undefined
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || barRef.current?.contains(event.target) !== true) {
        setOpen(null)
      }
    }
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const focusTop = (index: number): void => {
    setFocusedTop(index)
    topRefs.current[index]?.focus()
  }

  /**
   * 開いたあとに焦点を送る先。**描画が済んでから送る**（effect の中）。
   * 開く指示と同じ流れで送ると、項目がまだ無いので焦点が見出しに残る。
   */
  const pendingFocus = useRef<'first' | 'last' | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)

  useEffect(() => {
    const where = pendingFocus.current
    if (where === null || open === null) return
    pendingFocus.current = null
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
    ;(where === 'first' ? items[0] : items.at(-1))?.focus()
  }, [open, focusRequest])

  const openMenu = (index: number, focusItem: 'first' | 'last' | null): void => {
    pendingFocus.current = focusItem
    setOpen(index)
    setFocusedTop(index)
    // 同じメニューを開き直すときも effect を走らせる。
    setFocusRequest((count) => count + 1)
  }

  const close = (returnFocus: boolean): void => {
    const index = open
    setOpen(null)
    if (returnFocus && index !== null) focusTop(index)
  }

  const activate = (item: MenuItem): void => {
    if (!item.enabled) return
    close(false)
    onSelect(item)
  }

  const onTopKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const next = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (next !== undefined) {
      event.preventDefault()
      const target = wrap(index + next, menus.length)
      focusTop(target)
      if (open !== null) openMenu(target, null)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMenu(index, 'first')
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu(index, 'last')
      return
    }
    if (event.key === 'Escape' && open !== null) {
      event.preventDefault()
      close(true)
    }
  }

  const onItemKeyDown = (event: KeyboardEvent<HTMLButtonElement>, item: MenuItem): void => {
    const items = itemRefs.current.filter((entry): entry is HTMLButtonElement => entry !== null)
    const at = items.indexOf(event.currentTarget)
    const moves: Readonly<Record<string, () => void>> = {
      ArrowDown: () => items[wrap(at + 1, items.length)]?.focus(),
      ArrowUp: () => items[wrap(at - 1, items.length)]?.focus(),
      Home: () => items[0]?.focus(),
      End: () => items.at(-1)?.focus(),
      ArrowRight: () => {
        if (open === null) return
        const target = wrap(open + 1, menus.length)
        focusTop(target)
        openMenu(target, 'first')
      },
      ArrowLeft: () => {
        if (open === null) return
        const target = wrap(open - 1, menus.length)
        focusTop(target)
        openMenu(target, 'first')
      },
      Escape: () => {
        close(true)
      },
      Enter: () => {
        activate(item)
      },
      ' ': () => {
        activate(item)
      },
    }
    const move = moves[event.key]
    if (move === undefined) return
    event.preventDefault()
    // メニューの中の打鍵をワークベンチの打鍵（Space で再生など）へ流さない（L-018）。
    event.stopPropagation()
    move()
  }

  return (
    <div
      ref={barRef}
      className="flex h-7 shrink-0 items-center gap-1 border-b border-line bg-surface px-2 text-sm"
    >
      <div role="menubar" aria-label="メニュー" className="flex items-center">
        {menus.map((menu, index) => {
          const expanded = open === index
          return (
            <div key={menu.id} className="relative">
              <button
                ref={(element) => {
                  topRefs.current[index] = element
                }}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={expanded}
                tabIndex={focusedTop === index ? 0 : -1}
                onClick={() => {
                  if (expanded) close(false)
                  else openMenu(index, null)
                }}
                onPointerEnter={() => {
                  // 1 つ開いている間は、指を滑らせるだけで隣へ移れる（デスクトップの作法）。
                  if (open !== null && open !== index) openMenu(index, null)
                }}
                onKeyDown={(event) => {
                  onTopKeyDown(event, index)
                }}
                className={`h-6 shrink-0 whitespace-nowrap rounded px-2 ${
                  index === 0 ? 'font-bold text-text' : 'text-text'
                } ${
                  expanded ? 'bg-surface-2' : 'hover:bg-surface-2'
                } focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus`}
              >
                {/* アプリ名だけはヘッダと同じ二色にする。帯が低いので大きさは変えない。 */}
                {index === 0 ? (
                  <>
                    <span className="text-accent">{APP_NAME_ACCENT}</span>
                    {APP_NAME_REST}
                  </>
                ) : (
                  menu.label
                )}
              </button>
              {expanded && (
                <div
                  role="menu"
                  aria-label={menu.label}
                  className="absolute left-0 top-full z-50 mt-0.5 min-w-56 rounded-md border border-line bg-surface py-1 shadow-xl"
                >
                  {menu.items.map((item, itemIndex) => (
                    <button
                      key={item.id}
                      ref={(element) => {
                        itemRefs.current[itemIndex] = element
                      }}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      aria-disabled={!item.enabled}
                      title={item.disabledReason}
                      onClick={() => {
                        activate(item)
                      }}
                      onKeyDown={(event) => {
                        onItemKeyDown(event, item)
                      }}
                      className={`flex h-6 w-full items-center gap-6 px-3 text-left ${
                        item.enabled ? 'text-text hover:bg-surface-2' : 'cursor-default text-muted'
                      } focus:bg-surface-2 focus:outline-none`}
                    >
                      <span className="flex-1">{item.label}</span>
                      {item.shortcut !== undefined && (
                        <span className="text-xs text-muted">{item.shortcut}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {trailing !== undefined && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  )
}
