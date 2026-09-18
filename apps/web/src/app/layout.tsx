import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import 'dockview-react/dist/styles/dockview.css'
import './globals.css'
import { SiteHeader } from '@/components/site-header'
import { DEFAULT_THEME, THEME_ATTRIBUTE } from '@/lib/theme'

export const metadata: Metadata = {
  title: 'iXA Video Creator',
  description: 'AI ネイティブ映像制作プラットフォーム',
}

/**
 * 画面の殻（PHASE 5.9）。
 *
 * **幅を絞らない。** 以前は 1000px で中央寄せにしていて、1440px の画面で 3 割が空白だった。
 * タイムラインや一覧は横に長く、表示領域は全部使う。読み物として幅を絞りたい画面
 * （設定など）は、その画面が自分で `max-w` を持つ。
 *
 * `data-theme` はサーバで既定（ダーク）を出す。保存された選択は描画のあとに
 * `ThemeToggle` が反映する（lessons L-019）。
 */
const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="ja" {...{ [THEME_ATTRIBUTE]: DEFAULT_THEME }}>
    <body className="min-h-screen">
      <SiteHeader />
      <div className="px-6 py-6">{children}</div>
    </body>
  </html>
)

export default RootLayout
