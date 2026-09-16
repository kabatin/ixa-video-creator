import { describe, expect, it } from 'vitest'
import {
  colorForPrompt,
  figureColorForPrompt,
  fnv1a32,
  hslToHex,
  quadrantColorsForPrompt,
  toFfmpegColor,
} from '../stub/color.js'

const HEX = /^#[0-9A-F]{6}$/

describe('colorForPrompt', () => {
  it('同じプロンプトなら必ず同じ色になる', () => {
    expect(colorForPrompt('takepi の四面図')).toBe(colorForPrompt('takepi の四面図'))
  })

  it('違うプロンプトなら違う色になる', () => {
    expect(colorForPrompt('takepi の四面図')).not.toBe(colorForPrompt('hinata の四面図'))
    expect(colorForPrompt('a')).not.toBe(colorForPrompt('b'))
  })

  it('#RRGGBB 形式で、白文字が読める暗さに収まる', () => {
    for (const prompt of ['a', 'b', 'takepi', '四面図', 'turnaround sheet']) {
      const hex = colorForPrompt(prompt)
      expect(hex).toMatch(HEX)
      const luminance = Number.parseInt(hex.slice(1, 3), 16) + Number.parseInt(hex.slice(3, 5), 16)
      expect(luminance).toBeLessThan(255)
    }
  })
})

describe('quadrantColorsForPrompt', () => {
  it('4 つの互いに異なる色調を返す', () => {
    const colors = quadrantColorsForPrompt('takepi の四面図')
    expect(colors).toHaveLength(4)
    expect(new Set(colors).size).toBe(4)
    for (const color of colors) expect(color).toMatch(HEX)
  })

  it('決定的で、プロンプトが変われば変わる', () => {
    expect(quadrantColorsForPrompt('takepi')).toEqual(quadrantColorsForPrompt('takepi'))
    expect(quadrantColorsForPrompt('takepi')).not.toEqual(quadrantColorsForPrompt('hinata'))
  })
})

describe('figureColorForPrompt', () => {
  it('背景より明るいシルエット色を返す', () => {
    const figure = figureColorForPrompt('takepi')
    expect(figure).toMatch(HEX)
    expect(Number.parseInt(figure.slice(1, 3), 16)).toBeGreaterThan(100)
  })
})

describe('hslToHex / toFfmpegColor', () => {
  it('彩度 0 は灰色になる', () => {
    expect(hslToHex(0.3, 0, 0)).toBe('#000000')
    expect(hslToHex(0.3, 0, 1)).toBe('#FFFFFF')
  })

  it('drawbox が受け付ける 0xRRGGBB へ変換する', () => {
    expect(toFfmpegColor('#1A2B3C')).toBe('0x1A2B3C')
  })
})

describe('fnv1a32', () => {
  it('32bit 符号なしの決定的なハッシュを返す', () => {
    expect(fnv1a32('takepi')).toBe(fnv1a32('takepi'))
    expect(fnv1a32('takepi')).toBeGreaterThanOrEqual(0)
    expect(fnv1a32('takepi')).toBeLessThanOrEqual(0xffffffff)
  })
})
