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
      /**
       * 文字の尺度（UI-WORKBENCH §5.1 / PHASE 7.1）。**全体で 1 段小さくし、rem で持つ。**
       * ワークベンチだけの例外尺度は作らない（ADR-0021 D4）。根元の大きさは
       * 環境設定の「文字の大きさ」が `<html style="font-size">` で動かし、全部が一緒に伸縮する。
       * px は根元 16px のとき。素の `text-[11px]` は書かない（`density-scale.test.ts` が落とす）。
       */
      fontSize: {
        xs: ['0.6875rem', { lineHeight: '1rem' }], // 11px 表のセル・時刻・補足
        sm: ['0.75rem', { lineHeight: '1.125rem' }], // 12px 本文・ボタン・入力欄・タブ
        base: ['0.8125rem', { lineHeight: '1.25rem' }], // 13px パネル見出し
        lg: ['0.9375rem', { lineHeight: '1.375rem' }], // 15px ページ見出し・ダイアログの題名
        xl: ['1.0625rem', { lineHeight: '1.5rem' }], // 17px 尺度を単調に保つための中間
        '2xl': ['1.25rem', { lineHeight: '1.75rem' }], // 20px プロジェクト一覧の見出し
      },
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
