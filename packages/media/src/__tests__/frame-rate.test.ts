import { describe, expect, it } from 'vitest'
import { parseFrameRate } from '../frame-rate.js'

describe('parseFrameRate', () => {
  it('NTSC の分数を実 fps に換算する', () => {
    expect(parseFrameRate('30000/1001')).toBeCloseTo(29.97, 2)
    expect(parseFrameRate('24000/1001')).toBeCloseTo(23.976, 3)
    expect(parseFrameRate('60000/1001')).toBeCloseTo(59.94, 2)
  })

  it('整数分数をそのまま換算する', () => {
    expect(parseFrameRate('30/1')).toBe(30)
    expect(parseFrameRate('25/1')).toBe(25)
    expect(parseFrameRate('50/2')).toBe(25)
  })

  it('fps 不定を表す "0/0" は null にする', () => {
    expect(parseFrameRate('0/0')).toBeNull()
  })

  it('0 以下や分母 0 は null にする', () => {
    expect(parseFrameRate('0/1')).toBeNull()
    expect(parseFrameRate('30/0')).toBeNull()
    expect(parseFrameRate('-30/1')).toBeNull()
  })

  it('未定義・空文字・解釈不能な文字列は null にする', () => {
    expect(parseFrameRate(null)).toBeNull()
    expect(parseFrameRate(undefined)).toBeNull()
    expect(parseFrameRate('')).toBeNull()
    expect(parseFrameRate('   ')).toBeNull()
    expect(parseFrameRate('N/A')).toBeNull()
  })

  it('分数ではない単純な数値も受け付ける', () => {
    expect(parseFrameRate('30')).toBe(30)
    expect(parseFrameRate(' 29.97 ')).toBeCloseTo(29.97, 2)
  })
})
