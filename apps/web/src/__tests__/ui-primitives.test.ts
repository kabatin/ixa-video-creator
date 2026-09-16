import { describe, expect, it } from 'vitest'
import { formatClock, formatDuration, formatSpan, TIME_DECIMALS } from '@/lib/format-time'
import { WORDING, deleteConfirmMessage } from '@/lib/wording'

describe('時間の表示', () => {
  it('位置は時計形式', () => {
    expect(formatClock(0)).toBe('0:00.00')
    expect(formatClock(3.75)).toBe('0:03.75')
    expect(formatClock(75.5)).toBe('1:15.50')
    expect(formatClock(116.044)).toBe('1:56.04')
  })

  it('尺は秒', () => {
    expect(formatDuration(3.75)).toBe('3.75s')
    expect(formatDuration(0.5)).toBe('0.50s')
  })

  it('桁は画面ごとに変えない', () => {
    expect(TIME_DECIMALS).toBe(2)
    expect(formatDuration(1.23456)).toBe('1.23s')
    expect(formatClock(1.23456)).toBe('0:01.23')
  })

  it('区間は位置と尺の両方を出す', () => {
    expect(formatSpan(3.75, 2)).toBe('0:03.75 – 0:05.75（2.00s）')
  })

  it('壊れた値でも表示を壊さない', () => {
    expect(formatClock(Number.NaN)).toBe('0:00.00')
    expect(formatClock(-5)).toBe('0:00.00')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0.00s')
  })
})

describe('言葉', () => {
  it('削除と解除を別の言葉にする', () => {
    expect(WORDING.delete).not.toBe(WORDING.unlink)
  })

  it('削除の確認文は、何が消えるかと戻せないことを書く', () => {
    const message = deleteConfirmMessage('Look「ステージ衣装」')
    expect(message).toContain('ステージ衣装')
    expect(message).toContain('元に戻せません')
  })
})
