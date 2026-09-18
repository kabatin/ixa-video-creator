import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import 'dockview-react/dist/styles/dockview.css'
import './globals.css'
import { PreferencesRoot } from '@/components/preferences-root'
import { DEFAULT_THEME, THEME_ATTRIBUTE } from '@/lib/theme'

export const metadata: Metadata = {
  title: 'iXA Video Creator',
  description: 'AI ネイティブ映像制作プラットフォーム',
}

/**
 * 画面の殻（PHASE 5.9 / 7.1）。
 *
 * **ここは `<html>` と `<body>` だけを持つ。** 共通ヘッダと外周の余白は `(site)` の殻、
 * ワークベンチの全画面は `(workbench)` の殻が持つ（ADR-0021 D3）。
 *
 * `data-theme` はサーバで既定（ダーク）を出す。保存された環境設定は描画のあとに
 * `PreferencesRoot` が反映する（lessons L-019）。
 */
const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="ja" {...{ [THEME_ATTRIBUTE]: DEFAULT_THEME }}>
    <body className="min-h-screen">
      <PreferencesRoot>{children}</PreferencesRoot>
    </body>
  </html>
)

export default RootLayout
