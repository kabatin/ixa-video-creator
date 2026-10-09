import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMenus, type MenuState } from '@/lib/menu-model'
import { NEW_PROJECT_HREF, SITE_NAV_ENTRIES } from '@/lib/site-nav'

/**
 * ページの一覧と、そこへ行くリンクを突き合わせる。
 *
 * 検査したいことは 2 つある。
 *
 * 1. **リンク先のページが実在すること。** 以前キャラクター一覧がどこからも
 *    リンクされておらず、URL を直接打つしか到達手段が無かった。逆向き
 *    （リンクはあるがページが無い）も同じ事故で、こちらは 404 になる。
 * 2. **畳んだページが黙って戻ってこないこと。** Project は 1 画面の
 *    ワークベンチになったのに、`/projects/[id]/timeline` のような節ごとの
 *    URL が「引き継ぎ文書のため」に残り、そこから旧い画面割りが
 *    プロジェクト一覧のカードまで生き延びていた。
 *
 * 期待する一覧をここに直書きしているのは、ページを足すのも畳むのも
 * **意図的な編集であってほしい**から。数が合うだけの検査にすると、
 * 1 枚足して 1 枚消えても気づけない。
 */

const APP_DIR = join(__dirname, '..', 'app')

/** `app/` を辿って、実際に配信される URL の形を集める。ルートグループは URL に出ない。 */
const collectRoutes = (dir: string, segments: readonly string[] = []): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'page.tsx') return [`/${segments.join('/')}`.replace(/^\/$/, '/')]
    if (!entry.isDirectory()) return []
    const isGroup = entry.name.startsWith('(') && entry.name.endsWith(')')
    return collectRoutes(join(dir, entry.name), isGroup ? segments : [...segments, entry.name])
  })

const EXPECTED_ROUTES: readonly string[] = [
  '/',
  // 認証（2026-10-09）: Claude・Codex に渡す鍵の管理と、合言葉の入り口。
  '/access-keys',
  '/characters',
  '/characters/[id]',
  '/characters/new',
  '/library',
  '/login',
  '/projects/[id]',
  '/projects/new',
]

/** `/projects/[id]` は `/projects/01H…` に当たる。動的な区間は 1 区間ぶんだけ受ける。 */
const routeMatches = (route: string, path: string): boolean => {
  const a = route.split('/')
  const b = path.split('/')
  if (a.length !== b.length) return false
  return a.every((seg, i) => (seg.startsWith('[') && seg.endsWith(']') ? b[i] !== '' : seg === b[i]))
}

const pathOf = (href: string): string => href.split('?')[0] ?? href

describe('ページの一覧', () => {
  const routes = [...collectRoutes(APP_DIR)].sort()

  it('期待どおりのページだけがある', () => {
    expect(routes).toEqual([...EXPECTED_ROUTES].sort())
  })

  it('Project の節ごとのページを持たない（ワークベンチ 1 画面に畳んだ）', () => {
    const perSection = routes.filter((route) => /^\/projects\/\[id\]\/./.test(route))
    expect(perSection).toEqual([])
  })

  it('Shot 単独のページを持たない（ワークベンチの中で選ぶ）', () => {
    expect(routes.filter((route) => route.startsWith('/shots'))).toEqual([])
  })
})

describe('入口のリンク', () => {
  const routes = collectRoutes(APP_DIR)
  const state: MenuState = {
    hasCurrentShot: true,
    checkedCount: 0,
    canUndo: false,
    currentHasTake: false, splitBlocker: null, mergeBlocker: null,
  }
  const menuHrefs = buildMenus(state)
    .flatMap((menu) => menu.items)
    .flatMap((item) => (item.action?.kind === 'href' ? [item.action.href] : []))

  const targets = [...SITE_NAV_ENTRIES.map((entry) => entry.href), NEW_PROJECT_HREF, ...menuHrefs]

  /** キャラクター・素材ライブラリの入口は外した（プロジェクトごとになった。ADR-0034）。残りはプロジェクト一覧と新規。 */
  it('検査する行き先がある（空振りで合格にしない）', () => {
    expect(targets.length).toBeGreaterThanOrEqual(4)
  })

  it.each([...new Set(targets)])('%s に対応するページがある', (href) => {
    expect(routes.some((route) => routeMatches(route, pathOf(href)))).toBe(true)
  })

  it('ヘッダとワークベンチのメニューが同じ入口を出す', () => {
    SITE_NAV_ENTRIES.forEach((entry) => {
      expect(menuHrefs).toContain(entry.href)
    })
  })
})
