import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutoSaveSlider, SLIDER_KEY_IDLE_MS } from '@/components/workbench/ui/auto-save-slider'

/** つまみ（ADR-0050）。保存の口は 1 本で、矢印キーは止まってから保存し、保存中も動かせる（2026-10-17 のレビュー）。 */

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const slider = (onSave: (next: number) => Promise<void>) => {
  render(<AutoSaveSlider label="強さ" value={0.5} min={0} max={1} step={0.01} format={(v) => `${String(Math.round(v * 100))}%`} onSave={onSave} />)
  return screen.getByLabelText('強さ')
}

const press = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } })
  fireEvent.keyUp(input, { key: 'ArrowRight' })
}

describe('AutoSaveSlider', () => {
  it('矢印キーで続けて動かすと、止まってから 1 回だけ保存する', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    const input = slider(onSave)
    press(input, '0.51')
    press(input, '0.52')
    press(input, '0.53')
    expect(onSave).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLIDER_KEY_IDLE_MS)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith(0.53)
  })

  it('欄を離れたら待たずに保存し、待っていた分と 2 回書かない', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    const input = slider(onSave)
    press(input, '0.6')
    fireEvent.blur(input)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLIDER_KEY_IDLE_MS * 2)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('離す・欄を離れるが重なっても 1 回だけ', () => {
    const onSave = vi.fn(() => Promise.resolve())
    const input = slider(onSave)
    fireEvent.change(input, { target: { value: '0.7' } })
    fireEvent.pointerUp(input)
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('保存中も欄を止めない（矢印キーの続きが効く）', () => {
    const input = slider(() => new Promise<void>(() => undefined))
    fireEvent.change(input, { target: { value: '0.7' } })
    fireEvent.pointerUp(input)
    expect((input as HTMLInputElement).disabled).toBe(false)
  })
})
