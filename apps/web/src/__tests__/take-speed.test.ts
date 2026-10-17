import { describe, expect, it } from 'vitest'
import { parseSpeed, speedHint, speedOptions } from '@/lib/take-speed'

/** Shot の速さ（ADR-0050）の言葉。決め方は domain、ここは言葉にするだけ。 */
const shot = (speed: number, timing: 'trim' | 'fit' = 'trim') => ({ timing, durationSec: 1.2, sourceInSec: 0, speed })

describe('speedOptions', () => {
  it('よく使う速さを並べ、一覧に無い値はそれも並べる', () => {
    expect(speedOptions(1).map((option) => option.value)).toContain('1.5')
    expect(speedOptions(1.3).map((option) => option.value)).toContain('1.3')
    expect(speedOptions(1).find((option) => option.value === '1')?.label).toBe('1 倍（そのまま）')
  })
})

describe('parseSpeed', () => {
  it('0.5〜2.5 倍だけを読む', () => {
    expect(parseSpeed('1.5')).toBe(1.5)
    expect(parseSpeed('0.4')).toBeNull()
    expect(parseSpeed('3')).toBeNull()
    expect(parseSpeed('速い')).toBeNull()
  })
})

describe('speedHint', () => {
  it('頼む長さ（尺 × 速さ）を言う', () => {
    expect(speedHint(shot(1.5), null)).toBe('AI には 1.80s で頼みます。')
  })

  it('いまの Take が足りなければ、実際の速さと作り直したときの長さを言う', () => {
    // 1.2 秒の尺に 1.5 秒の Take、2 倍は無理なので 1.25 倍。
    expect(speedHint(shot(2), 1.5)).toContain('1.25 倍で流しています')
    expect(speedHint(shot(2), 1.5)).toContain('2.40s')
  })

  it('尺に合わせる間は速さを使わないと言う', () => {
    expect(speedHint(shot(2, 'fit'), 1.5)).toContain('Take の長さで決まります')
  })
})
