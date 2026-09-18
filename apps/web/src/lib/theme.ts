/**
 * 見た目の切り替え（PHASE 5.9）。**React を含まない。**
 *
 * 既定はダーク。映像ツールは素材の色を正しく見るために暗い背景を使う
 * （制作者の判断 2026-09-18）。ライトは選べる代替。
 */

export const THEMES = ['dark', 'light'] as const
export type Theme = (typeof THEMES)[number]

export const DEFAULT_THEME: Theme = 'dark'

/** `<html data-theme>` と `localStorage` の両方で使う鍵。 */
export const THEME_ATTRIBUTE = 'data-theme'
export const THEME_STORAGE_KEY = 'ixa.theme'

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

/**
 * 保存を読む。**最初の描画では呼ばないこと。** サーバに `localStorage` は無く、
 * 初期値をここから取るとサーバと食い違う（lessons L-019）。`useEffect` の中で読む。
 */
export const readStoredTheme = (): Theme => {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_THEME
    return parseStoredTheme(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

/** 書けなくても何も起きない。覚えられないだけで、見た目の切り替え自体は効く。 */
export const writeStoredTheme = (theme: Theme): void => {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // 保存を止めているブラウザ設定がある。続ける。
  }
}

/** `<html>` に反映する。DOM が無い環境では何もしない。 */
export const applyTheme = (theme: Theme): void => {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme)
}
