import { describe, expect, it } from 'vitest'
import { timingHint } from '@/lib/take-timing'

/**
 * 「Take を尺に合わせる」の説明（ADR-0026）。倍率の決め方は `@ixa/timeline` の 1 箇所で、
 * ここはそれを言葉にするだけ。
 */
const shot = (timing: 'trim' | 'fit', durationSec = 4, sourceInSec = 0) => ({ timing, durationSec, sourceInSec })

describe('timingHint', () => {
  it('Take の長さが分からなければ、何をするかだけ言う', () => {
    expect(timingHint(shot('trim'), null)).toBe('Take の長さに合わせて速度を変えます（0.5〜2.5 倍）。')
    expect(timingHint(shot('fit'), null)).toBe('Take の長さに合わせて速度を変えます（0.5〜2.5 倍）。')
  })

  it('fit なら、いまの倍率と何秒を何秒にしているか', () => {
    expect(timingHint(shot('fit'), 6)).toBe('いまの速度 1.50 倍（Take 6.00s → 尺 4.00s）。')
  })

  it('fit でも下限で足りなければ、止まる長さも言う', () => {
    expect(timingHint(shot('fit', 10), 4)).toBe(
      'いまの速度 0.50 倍（Take 4.00s → 尺 10.00s）。0.5 倍でも 2.00s 足りず、最後のコマで止まります。',
    )
  })

  it('trim で足りなければ、止まることと、合わせたときの倍率を言う', () => {
    expect(timingHint(shot('trim', 5), 4)).toBe(
      'Take が 1.00s 足りず、最後のコマで止まります。合わせると 0.80 倍になります。',
    )
  })

  it('trim で足りていれば、何をするかだけ言う（端数の不足は数えない）', () => {
    expect(timingHint(shot('trim'), 8)).toBe('Take の長さに合わせて速度を変えます（0.5〜2.5 倍）。')
    expect(timingHint(shot('trim'), 3.97)).toBe('Take の長さに合わせて速度を変えます（0.5〜2.5 倍）。')
  })

  it('使い始めより後ろだけを数える', () => {
    expect(timingHint(shot('fit', 4, 2), 6)).toBe('いまの速度 1.00 倍（Take 4.00s → 尺 4.00s）。')
  })
})
