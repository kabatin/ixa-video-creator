'use client'

import { usePreferences } from '@/components/preferences-root'
import { updateDisplay } from '@/lib/preferences'
import { nextTheme, themeToggleLabel } from '@/lib/theme'

/**
 * ダーク／ライトの切り替え（PHASE 5.9）。
 *
 * 値の持ち主は `PreferencesRoot`。保存と `<html>` への反映もそちらが行う（PHASE 7.1）。
 * 最初の描画は既定（ダーク）で、保存があれば描画のあとに切り替わる（lessons L-019）。
 */
export const ThemeToggle = () => {
  const { preferences, setPreferences } = usePreferences()
  const theme = preferences.display.theme

  return (
    <button
      type="button"
      onClick={() => {
        setPreferences(updateDisplay(preferences, { theme: nextTheme(theme) }))
      }}
      aria-pressed={theme === 'light'}
      className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {themeToggleLabel(theme)}
    </button>
  )
}
