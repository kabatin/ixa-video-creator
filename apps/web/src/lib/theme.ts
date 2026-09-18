/**
 * 見た目の切り替え（PHASE 5.9）。**React を含まない。**
 *
 * 既定はダーク。映像ツールは素材の色を正しく見るために暗い背景を使う
 * （制作者の判断 2026-09-18）。ライトは選べる代替。
 *
 * **保存は `preferences.ts` が持つ**（PHASE 7.1）。ここは値の意味と文言だけ。
 */
import { THEMES, THEME_ATTRIBUTE, type Theme } from '@/lib/preferences'

export { THEMES, THEME_ATTRIBUTE, type Theme }

export const DEFAULT_THEME: Theme = 'dark'

const isTheme = (value: unknown): value is Theme =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value)

/**
 * 保存されていた値を読む。**読めなければ既定。**
 * 壊れた値・無い・保存が使えない、はどれも既定でよく、区別して困ることが無い。
 */
export const parseStoredTheme = (raw: string | null | undefined): Theme =>
  isTheme(raw) ? raw : DEFAULT_THEME

export const nextTheme = (current: Theme): Theme => (current === 'dark' ? 'light' : 'dark')

export const themeLabel = (theme: Theme): string => (theme === 'dark' ? 'ダーク' : 'ライト')

/** 切り替えボタンの文言。**押したらどうなるか**を書く（いまの状態ではない）。 */
export const themeToggleLabel = (current: Theme): string =>
  `${themeLabel(nextTheme(current))}にする`
