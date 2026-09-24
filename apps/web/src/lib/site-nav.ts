import { CHARACTER_LIST_HREF } from '@/lib/character-links'

/**
 * ワークベンチの外の入口（`SiteHeader` と、ワークベンチの「iXA」メニュー）。
 *
 * **2 箇所に同じ並びを書き写さない。** 以前キャラクター一覧がどこからもリンクされて
 * おらず、URL を直接打つしか到達手段が無かった。片方にだけ足すと同じことが起きるので、
 * 並びは 1 つにして両方がこれを引く（`site-routes.test.ts` が行き先の存在を検査する）。
 */
export type SiteNavEntry = {
  /** メニュー項目の識別子。URL を変えても変わらない名前にする。 */
  readonly id: string
  readonly href: string
  readonly label: string
}

export const SITE_NAV_ENTRIES: readonly SiteNavEntry[] = Object.freeze([
  { id: 'projects', href: '/', label: 'プロジェクト一覧' },
  { id: 'characters', href: CHARACTER_LIST_HREF, label: 'キャラクター' },
  { id: 'library', href: '/library', label: '素材ライブラリ' },
])

/** 新規プロジェクトの入口。ここだけが URL を知っている。 */
export const NEW_PROJECT_HREF = '/projects/new'
