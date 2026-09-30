'use client'

import {
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'

/** 長押しとみなすまでの時間。iOS の長押しと同じくらい。 */
export const LONG_PRESS_MS = 500
/** これ以上動いたら長押しではなくドラッグ（タイムラインの移動・素材のドラッグを邪魔しない）。 */
export const LONG_PRESS_SLOP_PX = 8

export type MenuPoint = { readonly x: number; readonly y: number }

/** 物に付ける口。既存の同名の手当てがある物では、呼び出し側で合成する。 */
export type ContextMenuTriggerProps = {
  readonly onContextMenu: (event: MouseEvent<HTMLElement>) => void
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void
  readonly onPointerUp: () => void
  readonly onPointerCancel: () => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  readonly onClickCapture: (event: MouseEvent<HTMLElement>) => void
  /** 長押しで出る Safari の吹き出し（コピーなど）を止める。 */
  readonly style: CSSProperties
}

type Press = {
  readonly x: number
  readonly y: number
  readonly timer: ReturnType<typeof setTimeout>
}

/**
 * 右クリックのメニューを開く口（制作者 2026-09-30「iPad などでは右クリックが無い」）。
 *
 * - マウス・トラックパッド: 右クリック（`contextmenu`）。iPad にマウスを付けたときもこれ
 * - タッチ: **長押し**。iPad の Safari は長押しで `contextmenu` を出さないので、指を当ててから数える。
 *   動いたら取りやめ（ドラッグ）。開いた後の「押した」は打ち消す（物を開き直さない）
 * - キーボード: Shift+F10・メニューキー（物の下に開く）
 */
export const useContextMenuTrigger = <T>(
  open: (target: T, at: MenuPoint, origin: HTMLElement) => void,
) => {
  const press = useRef<Press | null>(null)
  /** 長押しで開いた直後。続く click と contextmenu（Android など）を打ち消す。 */
  const opened = useRef(false)

  const cancel = (): void => {
    if (press.current !== null) clearTimeout(press.current.timer)
    press.current = null
  }

  return (target: T): ContextMenuTriggerProps => ({
    onContextMenu: (event) => {
      event.preventDefault()
      cancel()
      if (opened.current) return
      open(target, { x: event.clientX, y: event.clientY }, event.currentTarget)
    },
    onPointerDown: (event) => {
      opened.current = false
      if (event.pointerType !== 'touch') return
      cancel()
      const origin = event.currentTarget
      const at = { x: event.clientX, y: event.clientY }
      press.current = {
        ...at,
        timer: setTimeout(() => {
          press.current = null
          opened.current = true
          open(target, at, origin)
        }, LONG_PRESS_MS),
      }
    },
    onPointerMove: (event) => {
      const current = press.current
      if (current === null) return
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > LONG_PRESS_SLOP_PX)
        cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onKeyDown: (event) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
      event.preventDefault()
      event.stopPropagation()
      const box = event.currentTarget.getBoundingClientRect()
      open(target, { x: box.left + 8, y: box.bottom }, event.currentTarget)
    },
    onClickCapture: (event) => {
      if (!opened.current) return
      opened.current = false
      event.preventDefault()
      event.stopPropagation()
    },
    style: { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' },
  })
}
