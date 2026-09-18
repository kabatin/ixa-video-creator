import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, nextTheme, parseStoredTheme, themeToggleLabel } from '@/lib/theme'

/**
 * 見た目の切り替え。**既定はダーク**で、読めない値は必ず既定に倒れることを固定する。
 * 保存の読み書きは `preferences.test.ts` が見る。
 */

describe('既定', () => {
  it('ダークが既定', () => {
    expect(DEFAULT_THEME).toBe('dark')
  })
})

describe('保存の読み方', () => {
  it('知っている値はそのまま', () => {
    expect(parseStoredTheme('light')).toBe('light')
    expect(parseStoredTheme('dark')).toBe('dark')
  })

  it.each([null, undefined, '', 'blue', 'DARK'])('読めない値（%s）は既定', (raw) => {
    expect(parseStoredTheme(raw)).toBe(DEFAULT_THEME)
  })
})

describe('切り替え', () => {
  it('ダークとライトを行き来する', () => {
    expect(nextTheme('dark')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
  })

  /** ボタンには「押したらどうなるか」を書く。いまの状態を書くと、押す前後で読み違える。 */
  it('ボタンの文言は押した後の状態を言う', () => {
    expect(themeToggleLabel('dark')).toBe('ライトにする')
    expect(themeToggleLabel('light')).toBe('ダークにする')
  })
})
