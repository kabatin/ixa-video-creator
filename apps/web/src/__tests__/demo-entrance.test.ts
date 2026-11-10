import { describe, expect, it } from 'vitest'
import { DEMO_ENTRANCE_LABEL, demoEntrance, unreadableDemoEntrance, type DemoStatusForEntrance } from '@/lib/demo-entrance'
import { DEMO_HREF } from '@/lib/site-nav'

const status = (over: Partial<DemoStatusForEntrance>): DemoStatusForEntrance => ({ available: true, project: null, ...over })

describe('demoEntrance（一覧に「見本を開く」を出すか）', () => {
  it('見本があり、まだ入れていなければ出す', () => {
    expect(demoEntrance(status({}))).toEqual({ kind: 'offer', href: DEMO_HREF, label: DEMO_ENTRANCE_LABEL })
  })

  it('見本が用意されていなければ出さない（押しても何も入らない入口を作らない）', () => {
    expect(demoEntrance(status({ available: false }))).toEqual({ kind: 'none' })
  })

  it('もう入れてあれば出さない（一覧にその作品のカードがある）', () => {
    expect(demoEntrance(status({ project: { id: '01JPRPRPRPRPRPRPRPRPRPRPRP' } }))).toEqual({ kind: 'none' })
  })

  it('確かめられなかったことは、理由を持った別の状態にする（「無い」に畳まない）', () => {
    expect(unreadableDemoEntrance('サーバに届きませんでした')).toEqual({
      kind: 'unreadable',
      message: '見本があるかを確かめられませんでした（サーバに届きませんでした）',
    })
  })
})
