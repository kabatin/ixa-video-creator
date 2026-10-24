import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WaveformPlayhead } from '@/components/waveform-playhead'
import { playheadPct, secAtRatio } from '@/lib/waveform-playhead'

/** 素材ビューアの波形の再生位置（2026-10-24、制作者「どこを再生してるか分からない」）。 */

describe('playheadPct', () => {
  it('尺に対する割合。尺の外は端へ寄せる', () => {
    expect(playheadPct(5, 20)).toBe(25)
    expect(playheadPct(-1, 20)).toBe(0)
    expect(playheadPct(30, 20)).toBe(100)
  })

  it('尺が分からなければ線を引かない', () => {
    expect(playheadPct(1, 0)).toBeNull()
    expect(playheadPct(1, Number.NaN)).toBeNull()
  })
})

describe('secAtRatio', () => {
  it('押した所の秒。外は端へ寄せる', () => {
    expect(secAtRatio(0.5, 20)).toBe(10)
    expect(secAtRatio(-0.2, 20)).toBe(0)
    expect(secAtRatio(1.5, 20)).toBe(20)
  })
})

describe('WaveformPlayhead', () => {
  it('再生位置に線を引き、押した所へ飛ぶ', () => {
    const onSeek = vi.fn()
    render(<WaveformPlayhead currentSec={5} durationSec={20} onSeek={onSeek} />)
    const layer = screen.getByTestId('waveform-playhead')
    const line = layer.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(line.style.left).toBe('25%')

    layer.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 120, right: 300, bottom: 120, x: 100, y: 0, toJSON: () => ({}) })
    fireEvent.pointerDown(layer, { button: 0, clientX: 250 })
    expect(onSeek).toHaveBeenCalledWith(15)
  })

  it('右ボタンでは飛ばない', () => {
    const onSeek = vi.fn()
    render(<WaveformPlayhead currentSec={0} durationSec={20} onSeek={onSeek} />)
    fireEvent.pointerDown(screen.getByTestId('waveform-playhead'), { button: 2, clientX: 10 })
    expect(onSeek).not.toHaveBeenCalled()
  })
})
