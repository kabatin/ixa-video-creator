import Link from 'next/link'
import { PreferencesButton } from '@/components/preferences-button'
import { ThemeToggle } from '@/components/theme-toggle'
import { CHARACTER_LIST_HREF } from '@/lib/character-links'

/**
 * 全画面に出す入口。
 *
 * **ここに無い画面は、利用者から見て存在しない。** 以前キャラクター一覧が
 * どこからもリンクされておらず、URL を直接打つしか到達手段が無かった。
 * トップレベルの画面を足したらここに追記すること。
 *
 * 帯は画面の幅いっぱいに張る（PHASE 5.9）。中身は左右の余白だけを持つ。
 */
const ENTRIES: readonly { readonly href: string; readonly label: string }[] = Object.freeze([
  { href: '/', label: 'プロジェクト' },
  { href: CHARACTER_LIST_HREF, label: 'キャラクター' },
  { href: '/library', label: '素材ライブラリ' },
])

export const SiteHeader = () => (
  <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
    <nav aria-label="サイト全体" className="flex h-12 items-center gap-5 px-6">
      <Link href="/" className="text-sm font-semibold tracking-tight text-text">
        <span className="text-accent">iXA</span> Video Creator
      </Link>
      {ENTRIES.map((entry) => (
        <Link
          key={entry.href}
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
