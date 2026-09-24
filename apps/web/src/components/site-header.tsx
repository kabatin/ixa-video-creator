import Link from 'next/link'
import { PreferencesButton } from '@/components/preferences-button'
import { ThemeToggle } from '@/components/theme-toggle'
import { SITE_NAV_ENTRIES } from '@/lib/site-nav'

/**
 * ワークベンチの外の共通ヘッダ。
 *
 * **ここに無い画面は、利用者から見て存在しない。** 並びは `site-nav.ts` が持ち、
 * ワークベンチの「iXA」メニューも同じものを引く。
 *
 * 帯は画面の幅いっぱいに張る（PHASE 5.9）。中身は左右の余白だけを持つ。
 */

export const SiteHeader = () => (
  <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
    <nav aria-label="サイト全体" className="flex h-12 items-center gap-5 px-6">
      <Link href="/" className="text-sm font-semibold tracking-tight text-text">
        <span className="text-accent">iXA</span> Video Creator
      </Link>
      {SITE_NAV_ENTRIES.map((entry) => (
        <Link
          key={entry.id}
          href={entry.href}
          className="text-sm text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {entry.label}
        </Link>
      ))}
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <PreferencesButton />
      </div>
    </nav>
  </header>
)
