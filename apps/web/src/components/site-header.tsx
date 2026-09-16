import Link from 'next/link'
import { CHARACTER_LIST_HREF } from '@/lib/character-links'

/**
 * 全画面に出す入口。
 *
 * **ここに無い画面は、利用者から見て存在しない。** 以前キャラクター一覧が
 * どこからもリンクされておらず、URL を直接打つしか到達手段が無かった。
 * トップレベルの画面を足したらここに追記すること。
 */
const ENTRIES: readonly { readonly href: string; readonly label: string }[] = Object.freeze([
  { href: '/', label: 'プロジェクト' },
  { href: CHARACTER_LIST_HREF, label: 'キャラクター' },
])

export const SiteHeader = () => (
  <header className="mb-8 border-b border-slate-200 pb-4">
    <nav aria-label="サイト全体" className="flex items-center gap-5">
      <span className="text-sm font-semibold tracking-tight text-slate-900">iXA Video Creator</span>
      {ENTRIES.map((entry) => (
        <Link
          key={entry.href}
          href={entry.href}
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  </header>
)
