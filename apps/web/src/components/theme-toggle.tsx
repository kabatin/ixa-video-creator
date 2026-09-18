'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_THEME,
  applyTheme,
  nextTheme,
  readStoredTheme,
  themeToggleLabel,
  writeStoredTheme,
  type Theme,
} from '@/lib/theme'

/**
 * ダーク／ライトの切り替え（PHASE 5.9）。
 *
 * **最初の描画は既定（ダーク）で固定する。** 保存を初期値で読むとサーバと
 * 食い違ってハイドレーションが崩れる（lessons L-019）。描画のあとに読み、
 * 保存があればそこで切り替える。一瞬既定が見えるが、それが正しい。
 */
export const ThemeToggle = () => {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME)

  useEffect(() => {
    const stored = readStoredTheme()
    setTheme(stored)
    applyTheme(stored)
  }, [])

  const toggle = (): void => {
    const next = nextTheme(theme)
    setTheme(next)
    applyTheme(next)
    writeStoredTheme(next)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === 'light'}
      className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {themeToggleLabel(theme)}
    </button>
  )
}
