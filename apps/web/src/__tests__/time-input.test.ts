import { describe, expect, it } from 'vitest'
import { parseClockInput, parseDurationInput, parseMusicEndInput } from '@/lib/time-input'

describe('parseClockInput', () => {
  it.each([
    ['0:02.67', 2.67],
    ['1:02', 62],
    ['2.67', 2.67],
    ['  0:15.66 ', 15.66],
  ])('%s → %f', (raw, sec) => {
    expect(parseClockInput(raw)).toBeCloseTo(sec, 10)
  })

  it.each(['', 'abc', '-1', '0:61', '1:2:3'])('読めない %s は null', (raw) => {
    expect(parseClockInput(raw)).toBeNull()
  })
})

describe('parseDurationInput', () => {
  it.each([
    ['1.97s', 1.97],
    ['5.33', 5.33],
    ['4 s', 4],
  ])('%s → %f', (raw, sec) => {
    expect(parseDurationInput(raw)).toBeCloseTo(sec, 10)
  })

  it.each(['0', '0s', '-2', 'x'])('尺にならない %s は null', (raw) => {
    expect(parseDurationInput(raw)).toBeNull()
  })
})

describe('parseMusicEndInput（曲の終わり）', () => {
  it('空は曲の自然な終わりへ戻す', () => {
    expect(parseMusicEndInput('')).toEqual({ endSec: null })
    expect(parseMusicEndInput('  ')).toEqual({ endSec: null })
  })

  it('画面と同じ時計の形と素の秒を読む', () => {
    expect(parseMusicEndInput('0:26.38')).toEqual({ endSec: 26.38 })
    expect(parseMusicEndInput('26.38')).toEqual({ endSec: 26.38 })
  })

  it('0 と読めない値は受けない（0 で止めると曲が鳴らない）', () => {
    expect(parseMusicEndInput('0')).toBe('unreadable')
    expect(parseMusicEndInput('0:00.00')).toBe('unreadable')
    expect(parseMusicEndInput('-3')).toBe('unreadable')
    expect(parseMusicEndInput('あと')).toBe('unreadable')
  })
})
