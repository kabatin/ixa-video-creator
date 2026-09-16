import { describe, expect, it } from 'vitest'
import { DEFAULT_COLOR_TOLERANCE, parseHexColor, resolveBrandColor } from '../brand-color.js'
import { analyzeRgbFrame } from '../frame-stats.js'

/** 指定した RGB を pixelCount 個並べた rgb24 バッファ。 */
const solid = (r: number, g: number, b: number, pixelCount: number): Uint8Array =>
  Uint8Array.from(Array.from({ length: pixelCount }, () => [r, g, b]).flat())

const yellow = resolveBrandColor({
  key: 'ixa_yellow',
  hex: '#FFD200',
  minRatio: 0.05,
  maxRatio: 1,
})

describe('parseHexColor', () => {
  it('#RRGGBB を 0..255 の RGB にする', () => {
    expect(parseHexColor('#FFD200')).toEqual({ r: 255, g: 210, b: 0 })
  })

  it('短縮形や不正な文字列は受け付けない', () => {
    expect(() => parseHexColor('#FD0')).toThrow()
    expect(() => parseHexColor('FFD200')).toThrow()
    expect(() => parseHexColor('#GGGGGG')).toThrow()
  })
})

describe('analyzeRgbFrame', () => {
  it('全黒フレームの meanLuma は 0 になる', () => {
    expect(analyzeRgbFrame(solid(0, 0, 0, 16), []).meanLuma).toBe(0)
  })

  it('全白フレームの meanLuma は 1 になる', () => {
    expect(analyzeRgbFrame(solid(255, 255, 255, 16), []).meanLuma).toBeCloseTo(1)
  })

  it('Rec.709 の係数で輝度を出す（緑が最も明るい）', () => {
    const green = analyzeRgbFrame(solid(0, 255, 0, 4), []).meanLuma
    const red = analyzeRgbFrame(solid(255, 0, 0, 4), []).meanLuma
    const blue = analyzeRgbFrame(solid(0, 0, 255, 4), []).meanLuma
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
    expect(green).toBeCloseTo(0.7152)
  })

  it('ブランド色で埋まったフレームの占有率は 1 になる', () => {
    const stats = analyzeRgbFrame(solid(255, 210, 0, 9), [yellow])
    expect(stats.colorRatios.ixa_yellow).toBe(1)
  })

  it('ブランド色が無いフレームの占有率は 0 になる', () => {
    const stats = analyzeRgbFrame(solid(0, 0, 255, 9), [yellow])
    expect(stats.colorRatios.ixa_yellow).toBe(0)
  })

  it('半分だけブランド色なら占有率は 0.5 になる', () => {
    const pixels = Uint8Array.from([...solid(255, 210, 0, 2), ...solid(0, 0, 0, 2)])
    expect(analyzeRgbFrame(pixels, [yellow]).colorRatios.ixa_yellow).toBe(0.5)
  })

  it('許容距離のぶんだけ色ずれを拾う', () => {
    // 各チャンネル 20/255 ≒ 0.078 のずれ。距離 ≒ 0.11 で既定の許容内。
    const shifted = analyzeRgbFrame(solid(235, 195, 20, 4), [yellow])
    expect(shifted.colorRatios.ixa_yellow).toBe(1)

    const tight = resolveBrandColor({
      key: 'ixa_yellow',
      hex: '#FFD200',
      minRatio: 0,
      maxRatio: 1,
      tolerance: 0.01,
    })
    expect(analyzeRgbFrame(solid(235, 195, 20, 4), [tight]).colorRatios.ixa_yellow).toBe(0)
  })

  it('色を 1 つも渡さなければ colorRatios は空になる', () => {
    expect(analyzeRgbFrame(solid(1, 2, 3, 4), []).colorRatios).toEqual({})
  })

  it('1 ピクセルが複数の色に当たってよい（登録順に結果が依らない）', () => {
    const almost = resolveBrandColor({
      key: 'ixa_yellow_alt',
      hex: '#FFD400',
      minRatio: 0,
      maxRatio: 1,
    })
    const stats = analyzeRgbFrame(solid(255, 210, 0, 4), [yellow, almost])
    expect(stats.colorRatios).toEqual({ ixa_yellow: 1, ixa_yellow_alt: 1 })
  })

  it('rgb24 として辻褄の合わない長さは握り潰さず落とす', () => {
    expect(() => analyzeRgbFrame(new Uint8Array([1, 2, 3, 4]), [])).toThrow(/rgb24/)
    expect(() => analyzeRgbFrame(new Uint8Array([]), [])).toThrow(/rgb24/)
  })

  it('既定の許容距離は 0 より大きい（完全一致では一度も当たらないため）', () => {
    expect(DEFAULT_COLOR_TOLERANCE).toBeGreaterThan(0)
  })
})
