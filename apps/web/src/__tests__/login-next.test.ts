import { describe, expect, it } from 'vitest'
import { safeNextPath } from '@/lib/login-next'

/** 認証（2026-10-09）。入った直後に外のサイトへ送られないこと。 */
describe('safeNextPath', () => {
  it.each([
    ['/projects/01ABC?view=timeline', '/projects/01ABC?view=timeline'],
    ['/', '/'],
  ])('画面の中のパスは受ける: %s', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected)
  })

  it.each(['https://evil.example', '//evil.example/path', '/\\evil.example', 'javascript:alert(1)', ''])(
    '外を指すものは一覧へ: %s',
    (raw) => {
      expect(safeNextPath(raw)).toBe('/')
    },
  )

  it('無ければ一覧へ', () => {
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath(undefined)).toBe('/')
  })
})
