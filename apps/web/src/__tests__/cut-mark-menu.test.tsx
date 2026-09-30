import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CutWaveformOverlay } from '@/components/cut-waveform-overlay'
import { LONG_PRESS_MS } from '@/components/workbench/use-context-menu'
import { cutMarkMenuEntries } from '@/lib/context-menus'

/**
 * 聴きながら切るの区切り。右クリック（長押し）で「この区切りを消す」（2026-09-30）。
 * **右クリックを再生位置の移動や区切りの引きずりと取り違えない。**
 */

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 100,
    width: 1000,
    height: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 10 秒の曲の 5 秒に区切りが 1 つ（横 1000px なので 500px の所）。 */
const setup = () => {
  const handlers = {
    onSeek: vi.fn(),
    onSelectMark: vi.fn(),
    onDragStart: vi.fn(),
    onMarkContextMenu: vi.fn(),
  }
  const { container } = render(
    <CutWaveformOverlay
      marks={[{ atSec: 5, snappedTo: null }]}
      selectedIndex={-1}
      currentSec={0}
      durationSec={10}
      view={{ startSec: 0, endSec: 10 }}
      disabled={false}
      onMoveMark={vi.fn()}
      onDragEnd={vi.fn()}
      onZoom={vi.fn()}
      {...handlers}
    />,
  )
  const layer = container.firstElementChild
  if (!(layer instanceof HTMLElement)) throw new Error('区切りの層が無い')
  return { layer, ...handlers }
}

describe('区切りの右クリック', () => {
  it('中身は「この区切りを消す」（Delete でも消せる）', () => {
    expect(cutMarkMenuEntries()).toEqual([
      {
        kind: 'item',
        action: 'remove',
        label: 'この区切りを消す',
        shortcut: 'Delete',
        disabledReason: null,
      },
    ])
  })

  it('区切りの上で右クリックすると、その区切りのメニューの口を呼ぶ', () => {
    const { layer, onMarkContextMenu } = setup()

    fireEvent.contextMenu(layer, { clientX: 500, clientY: 20 })

    expect(onMarkContextMenu).toHaveBeenCalledWith(0, { x: 500, y: 20 }, layer)
  })

  it('右ボタンの押下で、再生位置を動かさず、区切りも掴まない', () => {
    const { layer, onSeek, onDragStart } = setup()

    fireEvent.pointerDown(layer, { clientX: 200, button: 2, pointerId: 1 })
    fireEvent.pointerDown(layer, { clientX: 500, button: 2, pointerId: 1 })

    expect(onSeek).not.toHaveBeenCalled()
    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('区切りを指で長押しするとメニューを開く', () => {
    const { layer, onMarkContextMenu } = setup()

    fireEvent.pointerDown(layer, { clientX: 500, clientY: 20, pointerId: 1, pointerType: 'touch' })
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS)
    })

    expect(onMarkContextMenu).toHaveBeenCalledWith(0, { x: 500, y: 20 }, layer)
  })

  it('区切りのない所の右クリックは、ブラウザのメニューのまま', () => {
    const { layer, onMarkContextMenu } = setup()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200 })

    act(() => {
      layer.dispatchEvent(event)
    })

    expect(onMarkContextMenu).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
