import { describe, expect, it } from 'vitest'
import { colorForShot, hslToHex } from '../stub/color.js'

const HEX_COLOR = /^#[0-9A-F]{6}$/

const channels = (hex: string): readonly number[] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
]

/** ITU-R BT.601 の相対輝度。白文字が読めるかの判断に使う。 */
const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex)
  return 0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0)
}

const SHOT_IDS = [
  '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  '01BX5ZZKBKACTAV9WEVGEMMVRZ',
  '01J0000000000000000000000A',
  'shot-1',
  'shot-2',
]

describe('hslToHex', () => {
  it('彩度 0 ならグレースケールになる', () => {
    expect(hslToHex(0.5, 0, 0)).toBe('#000000')
    expect(hslToHex(0.5, 0, 1)).toBe('#FFFFFF')
  })

  it('色相 0 は赤系になる', () => {
    const [r, g, b] = channels(hslToHex(0, 1, 0.5))
    expect(r).toBeGreaterThan(g ?? 0)
    expect(r).toBeGreaterThan(b ?? 0)
  })
})

describe('colorForShot', () => {
  it('#RRGGBB 形式を返す', () => {
    for (const id of SHOT_IDS) expect(colorForShot(id)).toMatch(HEX_COLOR)
  })

  it('同じ shotId なら必ず同じ色になる', () => {
    for (const id of SHOT_IDS) expect(colorForShot(id)).toBe(colorForShot(id))
  })

  it('違う shotId なら違う色になる', () => {
    const colors = SHOT_IDS.map(colorForShot)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('白文字が読める暗さに収まる', () => {
    for (const id of SHOT_IDS) expect(luminance(colorForShot(id))).toBeLessThan(110)
  })

  it('真っ黒にはならない（Shot ごとの違いが見える）', () => {
    for (const id of SHOT_IDS) expect(luminance(colorForShot(id))).toBeGreaterThan(10)
  })

  it('空文字でも決定的に色を返す', () => {
    expect(colorForShot('')).toMatch(HEX_COLOR)
    expect(colorForShot('')).toBe(colorForShot(''))
  })
})
