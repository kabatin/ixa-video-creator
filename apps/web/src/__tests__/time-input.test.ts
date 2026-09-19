import { describe, expect, it } from 'vitest'
import { parseClockInput, parseDurationInput } from '@/lib/time-input'

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
