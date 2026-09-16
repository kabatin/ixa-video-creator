import { describe, expect, it } from 'vitest'
import {
  DurationNotSupportedError, canProduceDuration, defaultSourceInSec, quantizeDuration,
} from '../generation/duration.js'

const VEO = { mode: 'enum', values: [4, 6, 8] } as const
const KLING = { mode: 'enum', values: [5, 10] } as const
const SEEDANCE = { mode: 'range', min: 4, max: 15 } as const

describe('quantizeDuration', () => {
  it('列挙モデルでは要求尺以上で最小の値へ切り上げる', () => {
    expect(quantizeDuration(3.75, VEO)).toBe(4)
    expect(quantizeDuration(4, VEO)).toBe(4)
    expect(quantizeDuration(4.01, VEO)).toBe(6)
    expect(quantizeDuration(3.75, KLING)).toBe(5)
    expect(quantizeDuration(5.5, KLING)).toBe(10)
  })

  it('範囲モデルでは下限未満を下限へ引き上げる', () => {
    expect(quantizeDuration(2, SEEDANCE)).toBe(4)
    expect(quantizeDuration(7.3, SEEDANCE)).toBe(7.3)
  })

  it('step 付きの範囲では step 単位へ切り上げる', () => {
    const stepped = { mode: 'range', min: 2, max: 10, step: 2 } as const
    expect(quantizeDuration(2, stepped)).toBe(2)
    expect(quantizeDuration(2.1, stepped)).toBe(4)
    expect(quantizeDuration(6, stepped)).toBe(6)
  })

  it('上限を超える尺は例外にする（無言で切り捨てない）', () => {
    expect(() => quantizeDuration(9, VEO)).toThrow(DurationNotSupportedError)
    expect(() => quantizeDuration(16, SEEDANCE)).toThrow(DurationNotSupportedError)
  })

  it('canProduceDuration は例外を投げずに可否を返す', () => {
    expect(canProduceDuration(3.75, VEO)).toBe(true)
    expect(canProduceDuration(9, VEO)).toBe(false)
  })
})

describe('defaultSourceInSec', () => {
  it('start_frame があるときは先頭から使う', () => {
    expect(defaultSourceInSec(4, 3.75, true)).toBe(0)
  })

  it('余りが小さいときは半分だけ頭を捨てる', () => {
    expect(defaultSourceInSec(4, 3.8, false)).toBeCloseTo(0.1)
  })

  it('余りが大きくても頭を捨てるのは上限まで', () => {
    expect(defaultSourceInSec(10, 3.75, false)).toBe(0.15)
  })

  it('余りが無ければ 0', () => {
    expect(defaultSourceInSec(4, 4, false)).toBe(0)
  })
})
