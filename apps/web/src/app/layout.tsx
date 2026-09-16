import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { SiteHeader } from '@/components/site-header'

export const metadata: Metadata = {
  title: 'iXA Video Creator',
  description: 'AI ネイティブ映像制作プラットフォーム',
}

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="ja">
    <body className="min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <SiteHeader />
        {children}
      </div>
    </body>
  </html>
)

export default RootLayout
