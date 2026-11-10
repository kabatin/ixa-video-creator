import { DEMO_HREF } from '@/lib/site-nav'

/**
 * 一覧に「見本を開く」を出すかどうか（ADR-0067）。**純粋。**
 *
 * 出すのは、見本が用意されていて、まだこのワークスペースに入れていないときだけ。
 * - 用意されていない → 出さない（押しても何も入らない入口を作らない）
 * - もう入れてある → 出さない（一覧にその作品のカードがある）
 * - 確かめられなかった → 「無い」に畳まず、理由を持った別の状態にする（lessons L-015）
 */

export const DEMO_ENTRANCE_LABEL = '見本を開く'

/** 判断に要る 2 つだけ（`WireDemoStatus` をそのまま渡せる）。 */
export type DemoStatusForEntrance = {
  readonly available: boolean
  readonly project: object | null
}

export type DemoEntrance =
  | { readonly kind: 'offer'; readonly href: string; readonly label: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly message: string }

export const demoEntrance = (status: DemoStatusForEntrance): DemoEntrance =>
  status.available && status.project === null
    ? { kind: 'offer', href: DEMO_HREF, label: DEMO_ENTRANCE_LABEL }
    : { kind: 'none' }

export const unreadableDemoEntrance = (reason: string): DemoEntrance => ({
  kind: 'unreadable',
  message: `見本があるかを確かめられませんでした（${reason}）`,
})
