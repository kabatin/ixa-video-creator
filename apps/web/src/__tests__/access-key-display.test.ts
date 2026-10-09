import { describe, expect, it } from 'vitest'
import { accessKeyState, formatWhen } from '@/lib/access-key-display'

describe('アクセス用の鍵の画面の言葉', () => {
  it('取り消したかどうかで状態を言う', () => {
    expect(accessKeyState({ revokedAt: null })).toBe('使える')
    expect(accessKeyState({ revokedAt: '2026-10-09T00:00:00.000Z' })).toBe('取り消し済み')
  })

  it('日時は日本時間で、無ければ「—」', () => {
    expect(formatWhen('2026-10-09T00:00:00.000Z')).toBe('2026/10/09 09:00')
    expect(formatWhen(null)).toBe('—')
  })
})
