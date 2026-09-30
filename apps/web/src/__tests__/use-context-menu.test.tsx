import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LONG_PRESS_MS, useContextMenuTrigger } from '@/components/workbench/use-context-menu'

/**
 * 右クリックのメニューを開く口。マウスは右クリック、**iPad・スマホは長押し**、キーボードは Shift+F10・メニューキー。
 * iPad の Safari は長押しで contextmenu を出さないので、指を当ててから数える。指が動けばドラッグなので開かない。
 */

const Target = ({
  onOpen,
  onClick,
}: {
  readonly onOpen: (at: { x: number; y: number }) => void
  readonly onClick?: () => void
}) => {
  const trigger = useContextMenuTrigger<string>((_target, at) => {
    onOpen(at)
  })
  return (
    <button type="button" onClick={onClick} {...trigger('shot-1')}>
      CUT-01
    </button>
  )
}

const touch = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) => {
  fireEvent[type](screen.getByRole('button', { name: 'CUT-01' }), {
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    pointerId: 1,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useContextMenuTrigger', () => {
  it('右クリックで、押した所に開く（ブラウザのメニューは出さない）', () => {
    const onOpen = vi.fn()
    render(<Target onOpen={onOpen} />)

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 50,
    })
    act(() => {
      screen.getByRole('button', { name: 'CUT-01' }).dispatchEvent(event)
    })

    expect(onOpen).toHaveBeenCalledWith({ x: 40, y: 50 })
    expect(event.defaultPrevented).toBe(true)
  })

  it('指を当てたまま動かさなければ、長押しで開く', () => {
    const onOpen = vi.fn()
    render(<Target onOpen={onOpen} />)

    touch('pointerDown', 10, 20)
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    })
    expect(onOpen).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(onOpen).toHaveBeenCalledWith({ x: 10, y: 20 })
  })

  it('指が動けばドラッグなので開かない', () => {
    const onOpen = vi.fn()
    render(<Target onOpen={onOpen} />)

    touch('pointerDown', 10, 20)
    touch('pointerMove', 30, 20)
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('早く離せば、ただのタップ（開かない）', () => {
    const onOpen = vi.fn()
    render(<Target onOpen={onOpen} />)

    touch('pointerDown', 10, 20)
    touch('pointerUp', 10, 20)
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('長押しの後の「押した」は打ち消す（物を開き直さない）', () => {
    const onClick = vi.fn()
    render(<Target onOpen={vi.fn()} onClick={onClick} />)

    touch('pointerDown', 10, 20)
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS)
    })
    touch('pointerUp', 10, 20)
    fireEvent.click(screen.getByRole('button', { name: 'CUT-01' }))
    fireEvent.click(screen.getByRole('button', { name: 'CUT-01' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('長押しの後に届く contextmenu（Android など）では二重に開かない', () => {
    const onOpen = vi.fn()
    render(<Target onOpen={onOpen} />)

    touch('pointerDown', 10, 20)
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS)
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'CUT-01' }), {
      clientX: 10,
      clientY: 20,
    })

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('マウスの押しっぱなしでは開かない（右クリックに任せる）', () => {
    const onOpen = vi.fn()
    render(<Target onOpen={onOpen} />)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'CUT-01' }), {
      pointerType: 'mouse',
      clientX: 1,
      clientY: 1,
    })
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('キーボードの Shift+F10・メニューキーでも開く', () => {
    const onOpen = vi.fn()
    render(<Target onOpen={onOpen} />)
    const button = screen.getByRole('button', { name: 'CUT-01' })

    fireEvent.keyDown(button, { key: 'F10', shiftKey: true })
    fireEvent.keyDown(button, { key: 'ContextMenu' })

    expect(onOpen).toHaveBeenCalledTimes(2)
  })
})
