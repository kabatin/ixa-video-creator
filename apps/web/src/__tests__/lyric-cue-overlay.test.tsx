import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LyricCueOverlay, cueLeftPercent } from '@/components/lyric-cue-overlay'

/**
 * 波形の上の歌い出しの印（制作者 2026-10-02「この画面すっごいわかりづらいなー」）。打った所が波形のどこかを見せる。
 * 見るだけ（掴めない・押せない）。表示している範囲の外は出さない。
 */

describe('cueLeftPercent', () => {
  it('表示している範囲の中の位置を % で返し、外は null', () => {
    const view = { startSec: 10, endSec: 20 }

    expect(cueLeftPercent(10, view)).toBe(0)
    expect(cueLeftPercent(15, view)).toBe(50)
    expect(cueLeftPercent(20, view)).toBe(100)
    expect(cueLeftPercent(9.99, view)).toBeNull()
    expect(cueLeftPercent(20.01, view)).toBeNull()
  })
})

describe('LyricCueOverlay', () => {
  it('範囲の中の歌い出しだけ印を出し、押しても何も起きない作り（pointer-events なし）', () => {
    const { container } = render(<LyricCueOverlay cues={[1, 12, 15, 30]} view={{ startSec: 10, endSec: 20 }} />)

    const marks = screen.getAllByTestId('lyric-cue-mark')
    expect(marks.map((mark) => mark.style.left)).toEqual(['20%', '50%'])
    expect(container.firstElementChild?.className).toContain('pointer-events-none')
  })
})
