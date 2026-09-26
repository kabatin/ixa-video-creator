import { describe, expect, it } from 'vitest'
import { APP_NAME } from '@/lib/app-name'
import {
  EXTRA_SHORTCUTS,
  buildMenus,
  listShortcuts,
  type MenuItem,
  type MenuState,
  type UndoAvailability,
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

  /** チェックした Shot を消す口もここ。選んでいる Shot が無くても、チェックがあれば消せる。 */
  it('チェックだけあれば削除は有効で、件数を項目名で言う', () => {
    const checkedOnly: MenuState = { ...EMPTY, checkedCount: 2 }

    expect(find(checkedOnly, 'delete-shot').enabled).toBe(true)
    expect(find(checkedOnly, 'delete-shot').label).toBe('チェックした 2 件を削除…')
    expect(find({ ...READY, checkedCount: 0 }, 'delete-shot').label).toBe('この Shot を削除…')
  })

  it('削除は確認のダイアログを開き、Delete キーを示す', () => {
    const entry = find(READY, 'delete-shot')

    expect(entry.action).toEqual({ kind: 'dialog', dialog: 'delete-shots' })
    expect(entry.shortcut).toBe('Delete')
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

/**
 * 「元に戻す」の 3 つの「戻せない」（S4）。
 *
 * **「読めなかった」を「戻せるものがありません」と同じ文にしない。**
 * 同じにすると、通信不良が「もう戻せない」に化け、戻せるはずの操作を諦めさせる（lessons L-015）。
 */
describe('元に戻す', () => {
  const undoItem = (canUndo: MenuState['canUndo']): MenuItem => find({ ...READY, canUndo }, 'undo')

  const aSummary = '粗編集を 49 件の Shot へ適用しました'
  const READY_UNDO: UndoAvailability = {
    state: 'ready',
    target: { summary: aSummary, shotCount: 49 },
  }

  it('まだ読めていない間は無効。「ありません」と言い切らない', () => {
    const entry = undoItem({ state: 'loading' })
    expect(entry.enabled).toBe(false)
    expect(entry.disabledReason).toBe('履歴をまだ読み込んでいません')
  })

  it('読めなかったときは無効。理由に原因まで出し、0 件と同じ文にしない', () => {
    const entry = undoItem({ state: 'unreadable', reason: 'API に接続できません' })
    expect(entry.enabled).toBe(false)
    expect(entry.disabledReason).toContain('履歴を読めませんでした')
    expect(entry.disabledReason).toContain('API に接続できません')
    expect(entry.disabledReason).not.toBe(undoItem({ state: 'none' }).disabledReason)
  })

  it('0 件のときだけ「戻せる一括操作がありません」', () => {
    const entry = undoItem({ state: 'none' })
    expect(entry.enabled).toBe(false)
    expect(entry.disabledReason).toBe('戻せる一括操作がありません')
  })

  it('3 つの「戻せない」がすべて違う文になる（畳んでいないことの確認）', () => {
    const reasons = (
      [{ state: 'loading' }, { state: 'unreadable', reason: 'offline' }, { state: 'none' }] as const
    ).map((undo) => undoItem(undo).disabledReason)
    expect(reasons.every((reason) => reason !== undefined)).toBe(true)
    expect(new Set(reasons).size).toBe(3)
  })

  it('戻せるときは有効で、項目名に何が戻るのかを出す（S2）', () => {
    const entry = undoItem(READY_UNDO)
    expect(entry.enabled).toBe(true)
    expect(entry.disabledReason).toBeUndefined()
    expect(entry.label).toContain(aSummary)
    expect(entry.shortcut).toBe('⌘Z')
  })

  it('長い見出しは項目名で省く（メニューを横に伸ばさない）', () => {
    const entry = undoItem({ state: 'ready', target: { summary: 'あ'.repeat(120), shotCount: 3 } })
    expect(entry.label.length).toBeLessThan(50)
    expect(entry.label).toContain('…')
  })

  it('履歴を持たない見本（boolean）は対象を名乗らない', () => {
    expect(undoItem(true).label).toBe('元に戻す')
    expect(undoItem(true).enabled).toBe(true)
    expect(undoItem(false).disabledReason).toBe('戻せる一括操作がありません')
  })
})

describe('行き先', () => {
  const menus = buildMenus(READY)

  it('§4 の 8 メニューがこの順で並ぶ', () => {
    expect(menus.map((menu) => menu.label)).toEqual([
      APP_NAME,
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
