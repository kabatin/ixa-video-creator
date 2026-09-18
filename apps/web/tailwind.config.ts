import type { Config } from 'tailwindcss'

/**
 * 役割の名前で色を引く（PHASE 5.9）。実際の値は `globals.css` のトークンにある。
 *
 * `rgb(var(--x) / <alpha-value>)` にしておくと `bg-danger/10` のような透過が効く。
 * 部品はここに無い色名（`slate-600` など）を使わないこと。ダーク／ライトの
 * 切り替えは CSS 変数の差し替えだけで済ませたい。
 */
const token = (name: string): string => `rgb(var(--${name}) / <alpha-value>)`

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        line: token('line'),
        'line-strong': token('line-strong'),
        text: token('text'),
        muted: token('muted'),
        faint: token('faint'),
        accent: token('accent'),
        'accent-fg': token('accent-fg'),
        'accent-soft': token('accent-soft'),
        ok: token('ok'),
        warn: token('warn'),
        danger: token('danger'),
        info: token('info'),
        focus: token('focus'),
      },
      outlineColor: {
        focus: token('focus'),
      },
      ringColor: {
        focus: token('focus'),
      },
    },
  },
  plugins: [],
}

export default config
