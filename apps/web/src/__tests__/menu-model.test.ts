import { describe, expect, it } from 'vitest'
import {
  EXTRA_SHORTCUTS,
  buildMenus,
  listShortcuts,
  type MenuItem,
  type MenuState,
} from '@/lib/menu-model'
import { PANEL_IDS } from '@/lib/workbench-layout'

/** メニューの有効判定（UI-WORKBENCH §4 / §10）。 */

const READY: MenuState = { hasCurrentShot: true, checkedCount: 3, canUndo: true, currentHasTake: true }
const EMPTY: MenuState = { hasCurrentShot: false, checkedCount: 0, canUndo: false, currentHasTake: false }

const find = (state: MenuState, id: string): MenuItem => {
  const found = buildMenus(state)
    .flatMap((menu) => menu.items)
    .find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`メニュー項目 ${id} がありません`)
  return found
}

describe('有効判定', () => {
  it('選択なしで削除が無効', () => {
    expect(find(EMPTY, 'delete-shot').enabled).toBe(false)
    expect(find(EMPTY, 'delete-shot').disabledReason).toBeDefined()
    expect(find(READY, 'delete-shot').enabled).toBe(true)
  })

  it('履歴なしで元に戻すが無効', () => {
    expect(find(EMPTY, 'undo').enabled).toBe(false)
    expect(find(READY, 'undo').enabled).toBe(true)
  })

  it('やり直すは常に無効', () => {
    expect(find(EMPTY, 'redo').enabled).toBe(false)
    expect(find(READY, 'redo').enabled).toBe(false)
  })

  it('チェックが無ければ一括変更と一括生成は無効', () => {
    expect(find(EMPTY, 'bulk-edit').enabled).toBe(false)
    expect(find(EMPTY, 'bulk-generate').enabled).toBe(false)
    expect(find(READY, 'bulk-edit').enabled).toBe(true)
    expect(find(READY, 'bulk-generate').enabled).toBe(true)
  })

  it('採用を外すは、選んだ Shot に採用 Take があるときだけ（PHASE 8）', () => {
    expect(find(READY, 'unselect-take').enabled).toBe(true)
    expect(find({ ...READY, currentHasTake: false }, 'unselect-take').enabled).toBe(false)
    expect(find(EMPTY, 'unselect-take').enabled).toBe(false)
  })

  it('有効な項目には押せない理由を付けない', () => {
    buildMenus(READY)
      .flatMap((menu) => menu.items)
      .filter((entry) => entry.enabled)
      .forEach((entry) => {
        expect(entry.disabledReason).toBeUndefined()
      })
  })
})

describe('行き先', () => {
  const menus = buildMenus(READY)

  it('§4 の 8 メニューがこの順で並ぶ', () => {
    expect(menus.map((menu) => menu.label)).toEqual([
      'iXA',
      'ファイル',
      '編集',
      '表示',
      '素材',
      'Shot',
      '生成',
      'ヘルプ',
    ])
  })

  it('表示メニューから全パネルへ行ける（到達できないパネルを作らない）', () => {
    const panels = menus
      .flatMap((menu) => menu.items)
      .flatMap((entry) => (entry.action.kind === 'panel' ? [entry.action.panel] : []))
    expect([...panels].sort()).toEqual([...PANEL_IDS].sort())
  })

  it('書き出し / 設定 / 環境設定はダイアログ、楽曲は素材として開く（PHASE 8.2）', () => {
    const items = menus.flatMap((menu) => menu.items)
    const dialogs = items.flatMap((entry) => (entry.action.kind === 'dialog' ? [entry.action.dialog] : []))
    expect(dialogs).toEqual(expect.arrayContaining(['render', 'settings', 'preferences']))
    expect(items.find((entry) => entry.id === 'music')?.action).toEqual({
      kind: 'command',
      command: 'inspect-master-track',
    })
  })

  it('項目の id は重ならない', () => {
    const ids = menus.flatMap((menu) => menu.items.map((entry) => entry.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('ショートカット一覧', () => {
  it('メニューのショートカットから作る', () => {
    expect(listShortcuts(buildMenus(EMPTY))).toEqual(
      expect.arrayContaining([
        { label: '元に戻す', shortcut: '⌘Z' },
        { label: '環境設定…', shortcut: '⌘,' },
      ]),
    )
    expect(EXTRA_SHORTCUTS.map((entry) => entry.shortcut)).toContain('Space')
  })
})
