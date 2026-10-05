import { describe, expect, it } from 'vitest'
import { buildMenus, type MenuState } from '@/lib/menu-model'
import { PANEL_IDS, PANEL_SPECS } from '@/lib/workbench-layout'

/**
 * 「表示」メニューの項目名とパネルのタブ名を突き合わせる。
 *
 * ずれていると、メニューで選んだものと出てくるタブの名前が違う。
 * 実際に「素材ビューア」を選ぶとタブには「素材」と出ており、
 * すぐ上の「素材ツリー」と紛らわしかった。人が 2 箇所を手で揃える形にしない。
 */

/** パネルを開くだけの項目を拾う。判定に要る最小限の文脈を渡す。 */
const viewItems = (menus: ReturnType<typeof buildMenus>) =>
  menus
    .flatMap((menu) => menu.items)
    .flatMap((item) =>
      item.action?.kind === 'panel' ? [{ panel: item.action.panel, label: item.label }] : [],
    )

describe('メニューの項目名とパネル名', () => {
  const state: MenuState = {
    hasCurrentShot: true,
    checkedCount: 0,
    canUndo: false,
    currentHasTake: false, splitBlocker: null, mergeBlocker: null,
  }
  const menus = buildMenus(state)
  const items = viewItems(menus)

  it('パネルを開く項目が 11 枚ぶんある', () => {
    expect(items.map((entry) => entry.panel).sort()).toEqual([...PANEL_IDS].sort())
  })

  it('項目名がタブ名と一致する', () => {
    items.forEach((entry) => {
      expect(entry.label).toBe(PANEL_SPECS[entry.panel].title)
    })
  })
})
