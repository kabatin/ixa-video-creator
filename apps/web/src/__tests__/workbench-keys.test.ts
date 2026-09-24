import { describe, expect, it } from 'vitest'
import { neighborShotId, resolveWorkbenchKey, type WorkbenchKeyEvent } from '@/lib/workbench-keys'

/** ワークベンチの打鍵（UI-WORKBENCH 7.2）。衝突の解き方を固定する（L-018）。 */

const press = (key: string, options: Partial<WorkbenchKeyEvent> = {}): WorkbenchKeyEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: { tagName: 'DIV' },
  insideCutEditor: false,
  ...options,
})

describe('resolveWorkbenchKey', () => {
  it.each([
    [press('z', { metaKey: true }), 'undo'],
    [press('z', { ctrlKey: true }), 'undo'],
    [press('Z', { metaKey: true, shiftKey: true }), 'redo'],
    [press('y', { metaKey: true }), 'history'],
    [press(',', { metaKey: true }), 'preferences'],
    [press(' '), 'toggle-play'],
    [press('ArrowLeft'), 'previous-shot'],
    [press('ArrowRight'), 'next-shot'],
  ] as const)('%o → %s', (event, expected) => {
    expect(resolveWorkbenchKey(event)).toBe(expected)
  })

  it('入力欄の中では何も取らない（⌘Z は文字の取り消し）', () => {
    expect(resolveWorkbenchKey(press('z', { metaKey: true, target: { tagName: 'INPUT' } }))).toBeNull()
    expect(resolveWorkbenchKey(press(' ', { target: { tagName: 'TEXTAREA' } }))).toBeNull()
    expect(resolveWorkbenchKey(press('ArrowLeft', { target: { isContentEditable: true } }))).toBeNull()
  })

  /**
   * **見えているかではなく、フォーカスの居場所で決める。**
   * 以前は「聴きながら切るが見えているか」で譲っていたが、既定の配置では常に見えているので
   * Space と ← → が開いた直後から一度も効かなかった（B2）。持ち主の正は `resolveKeyOwner`。
   */
  it('フォーカスが聴きながら切るの中にある間は Space と ← → を任せる', () => {
    expect(resolveWorkbenchKey(press(' ', { insideCutEditor: true }))).toBeNull()
    expect(resolveWorkbenchKey(press('ArrowRight', { insideCutEditor: true }))).toBeNull()
    // ⌘Z はワークベンチのもの
    expect(resolveWorkbenchKey(press('z', { metaKey: true, insideCutEditor: true }))).toBe('undo')
  })

  it('聴きながら切るが見えていても、フォーカスが外なら Space と ← → は効く', () => {
    expect(resolveWorkbenchKey(press(' ', { insideCutEditor: false }))).toBe('toggle-play')
    expect(resolveWorkbenchKey(press('ArrowLeft', { insideCutEditor: false }))).toBe(
      'previous-shot',
    )
  })

  it('ボタンやタブの上の Space / 矢印はその部品のもの', () => {
    expect(resolveWorkbenchKey(press(' ', { target: { tagName: 'BUTTON' } }))).toBeNull()
    expect(resolveWorkbenchKey(press('ArrowRight', { target: { tagName: 'DIV', role: 'tab' } }))).toBeNull()
  })

  it('修飾付きの矢印や Space は取らない', () => {
    expect(resolveWorkbenchKey(press('ArrowLeft', { shiftKey: true }))).toBeNull()
    expect(resolveWorkbenchKey(press(' ', { altKey: true }))).toBeNull()
    expect(resolveWorkbenchKey(press('x', { metaKey: true }))).toBeNull()
  })
})

describe('neighborShotId', () => {
  const shots = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('隣へ動く', () => {
    expect(neighborShotId(shots, 'b', 1)).toBe('c')
    expect(neighborShotId(shots, 'b', -1)).toBe('a')
  })

  it('端では止まる', () => {
    expect(neighborShotId(shots, 'c', 1)).toBe('c')
    expect(neighborShotId(shots, 'a', -1)).toBe('a')
  })

  it('選んでいなければ先頭、空なら null', () => {
    expect(neighborShotId(shots, null, 1)).toBe('a')
    expect(neighborShotId([], null, 1)).toBeNull()
  })
})
