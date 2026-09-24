import { ProjectId, ShotId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_WORKBENCH_QUERY,
  LEGACY_SECTIONS,
  MAIN_TABS,
  legacySectionHref,
  legacyShotHref,
  parseWorkbenchQuery,
  workbenchHref,
} from '@/lib/workbench-url'
import { PANEL_IDS, PANEL_SPECS } from '@/lib/workbench-layout'
import { PROJECT_ID, SHOT_ID } from './fixtures'

/** ワークベンチの URL（UI-WORKBENCH §7.1 / §10）。 */

const projectId = ProjectId.parse(PROJECT_ID)
const shotId = ShotId.parse(SHOT_ID)

describe('parseWorkbenchQuery', () => {
  it('何も無ければ全部「指定なし」', () => {
    expect(parseWorkbenchQuery({})).toEqual(EMPTY_WORKBENCH_QUERY)
  })

  it('正しい値は読む', () => {
    expect(
      parseWorkbenchQuery({
        shot: SHOT_ID,
        main: 'compare',
        bottom: 'timeline',
        side: 'inspector',
        dialog: 'render',
      }),
    ).toEqual({ shot: shotId, main: 'compare', bottom: 'timeline', side: 'inspector', dialog: 'render' })
  })

  it('不正な ?shot は無視して既定（先頭 Shot）へ', () => {
    expect(parseWorkbenchQuery({ shot: 'not-a-ulid' }).shot).toBeNull()
  })

  /**
   * **読めない指定は「指定なし」と同じに倒す。**
   *
   * 以前は既定のタブ（storyboard など）へ倒していた。しかし `null` は
   * 「保存した配置のまま開く」を意味するので、既定へ倒すと打ち間違いや古いリンクが
   * **利用者の配置を勝手に書き換える**ことになっていた。触らないのが正しい。
   */
  it('main の未知の値は配置を触らない', () => {
    expect(parseWorkbenchQuery({ main: 'monitor' }).main).toBeNull()
  })

  it('bottom / side の未知の値も配置を触らない', () => {
    const query = parseWorkbenchQuery({ bottom: 'x', side: 'y' })
    expect(query.bottom).toBeNull()
    expect(query.side).toBeNull()
  })

  it('中央上の 5 枚はすべて URL で開ける', () => {
    MAIN_TABS.forEach((tab) => {
      expect(parseWorkbenchQuery({ main: tab }).main).toBe(tab)
    })
  })

  it('中央上のタブは PANEL_SPECS の main 区画と同じ集合', () => {
    const mainPanels = PANEL_IDS.filter((id) => PANEL_SPECS[id].area === 'main')
    expect([...MAIN_TABS].sort()).toEqual([...mainPanels].sort())
  })

  it('知らないダイアログは開かない', () => {
    expect(parseWorkbenchQuery({ dialog: 'delete-everything' }).dialog).toBeNull()
  })

  it('同じ鍵が複数あれば先頭を使う', () => {
    expect(parseWorkbenchQuery({ main: ['preview', 'compare'] }).main).toBe('preview')
  })
})

describe('workbenchHref', () => {
  it('指定が無ければ素の URL', () => {
    expect(workbenchHref(projectId)).toBe(`/projects/${PROJECT_ID}`)
  })

  it('組んだ URL を読み戻すと同じ', () => {
    const query = { shot: shotId, main: 'preview', bottom: null, side: 'inspector', dialog: null } as const
    const url = new URL(workbenchHref(projectId, query), 'http://x')
    expect(parseWorkbenchQuery(Object.fromEntries(url.searchParams))).toEqual(query)
  })
})

describe('旧 URL の行き先（§7.1 の表）', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['storyboard', '?main=storyboard&bottom=cutter'],
    ['shots', '?side=shots'],
    ['timeline', '?bottom=timeline'],
    ['music', '?dialog=music'],
    ['render', '?dialog=render'],
    ['settings', '?dialog=settings'],
  ]

  it('表の全部を押さえている', () => {
    expect(cases.map(([section]) => section)).toEqual([...LEGACY_SECTIONS])
  })

  it.each(cases)('%s → %s', (section, search) => {
    const target = LEGACY_SECTIONS.find((entry) => entry === section)
    if (target === undefined) throw new Error(section)
    expect(legacySectionHref(projectId, target)).toBe(`/projects/${PROJECT_ID}${search}`)
  })

  it('/shots/[id] → Shot を選び、Take 比較とインスペクター', () => {
    expect(legacyShotHref(projectId, shotId)).toBe(
      `/projects/${PROJECT_ID}?shot=${SHOT_ID}&main=compare&side=inspector`,
    )
  })
})
