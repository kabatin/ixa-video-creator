import { describe, expect, it } from 'vitest'
import { resolveCutEditorCommand, type CutEditorKeyEvent } from '@/lib/cut-editor-keys'
import {
  CUT_EDITOR_ATTRIBUTE,
  ownsPlainKeys,
  resolveKeyOwner,
  type KeyTargetLike,
} from '@/lib/playback-state'
import { resolveWorkbenchKey, type WorkbenchKeyEvent } from '@/lib/workbench-keys'

/**
 * キーの持ち主を決めるのは**フォーカスの居場所だけ**（B2 / B3）。
 *
 * 以前はワークベンチ側が「聴きながら切るが見えているか」で譲っていた。
 * 既定の配置では常に見えているので、Space と `←` `→` が開いた直後から
 * 一度も効かなかった。狭い画面では逆に常に false で、1 打で両方が動いた。
 *
 * **見えている ≠ 操作している。** ここでは持ち主の決め方そのものを固定する。
 */

const div: KeyTargetLike = { tagName: 'DIV', isContentEditable: false }
const button: KeyTargetLike = { tagName: 'BUTTON', isContentEditable: false }
const menuItem: KeyTargetLike = { tagName: 'DIV', isContentEditable: false, role: 'menuitem' }
const field: KeyTargetLike = { tagName: 'INPUT', isContentEditable: false }

describe('resolveKeyOwner', () => {
  it.each([
    ['入力欄', field, true, 'text-entry'],
    ['入力欄（カット編集の外）', field, false, 'text-entry'],
    ['ボタン', button, true, 'widget'],
    ['メニュー項目', menuItem, false, 'widget'],
    ['カット編集の中の素の要素', div, true, 'cut-editor'],
    ['カット編集の外の素の要素', div, false, 'workbench'],
    ['どこでもない（target なし）', null, false, 'workbench'],
  ] as const)('%s は %s のもの', (_name, target, inside, owner) => {
    expect(resolveKeyOwner(target, inside)).toBe(owner)
  })

  it('入れ物の目印は 1 つの定数から引く（DOM 側と食い違わせない）', () => {
    expect(CUT_EDITOR_ATTRIBUTE).toBe('data-cut-editor')
  })
})

describe('ownsPlainKeys', () => {
  it.each(['BUTTON', 'A', 'SUMMARY'])('%s は自分で Space / 矢印を使う', (tagName) => {
    expect(ownsPlainKeys({ tagName, isContentEditable: false })).toBe(true)
  })

  it.each(['menuitem', 'tab', 'option', 'slider', 'checkbox'])('role=%s も同じ', (role) => {
    expect(ownsPlainKeys({ tagName: 'DIV', isContentEditable: false, role })).toBe(true)
  })

  it('素の要素と role なしは奪わない', () => {
    expect(ownsPlainKeys(div)).toBe(false)
    expect(ownsPlainKeys({ tagName: 'DIV', isContentEditable: false, role: null })).toBe(false)
    expect(ownsPlainKeys(null)).toBe(false)
  })
})

// --- 2 つの判定が同じ答えを使っていること ---

type Situation = {
  readonly name: string
  readonly target: KeyTargetLike | null
  readonly insideCutEditor: boolean
}

const SITUATIONS: readonly Situation[] = [
  { name: 'カット編集の外', target: div, insideCutEditor: false },
  { name: 'カット編集の中', target: div, insideCutEditor: true },
  { name: 'カット編集の中のボタン', target: button, insideCutEditor: true },
  { name: 'カット編集の外のボタン', target: button, insideCutEditor: false },
  { name: 'メニュー項目', target: menuItem, insideCutEditor: false },
  { name: 'カット編集の中の入力欄', target: field, insideCutEditor: true },
]

/** ワークベンチと聴きながら切るが取り合うキー。 */
const CONTESTED_KEYS: readonly string[] = [' ', 'ArrowLeft', 'ArrowRight']
/** 聴きながら切るだけが持つキー。持ち主の判定が効いているかを見る。 */
const CUTTER_ONLY_KEYS: readonly string[] = ['Enter', 'Backspace', 'n', ',', '.']

const workbenchEvent = (key: string, situation: Situation): WorkbenchKeyEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: situation.target,
  insideCutEditor: situation.insideCutEditor,
})

const cutterEvent = (key: string, situation: Situation): CutEditorKeyEvent => ({
  key,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target:
    situation.target === null
      ? null
      : {
          tagName: situation.target.tagName ?? '',
          isContentEditable: situation.target.isContentEditable ?? false,
          role: situation.target.role ?? null,
        },
  insideCutEditor: situation.insideCutEditor,
})

describe('1 打で動くのは片方だけ', () => {
  for (const situation of SITUATIONS) {
    for (const key of [...CONTESTED_KEYS, ...CUTTER_ONLY_KEYS]) {
      it(`${situation.name} の ${key === ' ' ? 'Space' : key}`, () => {
        const workbench = resolveWorkbenchKey(workbenchEvent(key, situation))
        const cutter = resolveCutEditorCommand(cutterEvent(key, situation))

        expect(workbench === null || cutter === null).toBe(true)
      })
    }
  }
})

describe('フォーカスが外にあるとき', () => {
  const outside: Situation = { name: '外', target: div, insideCutEditor: false }

  it('Space と ← → はワークベンチのもの（既定の配置でカッターが見えていても）', () => {
    expect(resolveWorkbenchKey(workbenchEvent(' ', outside))).toBe('toggle-play')
    expect(resolveWorkbenchKey(workbenchEvent('ArrowLeft', outside))).toBe('previous-shot')
    expect(resolveWorkbenchKey(workbenchEvent('ArrowRight', outside))).toBe('next-shot')
  })

  it('カッターは 1 つも取らない', () => {
    for (const key of [...CONTESTED_KEYS, ...CUTTER_ONLY_KEYS]) {
      expect(resolveCutEditorCommand(cutterEvent(key, outside))).toBeNull()
    }
  })
})

describe('フォーカスが中にあるとき', () => {
  const inside: Situation = { name: '中', target: div, insideCutEditor: true }

  it('カッターが取る', () => {
    expect(resolveCutEditorCommand(cutterEvent(' ', inside))).toEqual({
      source: 'playback',
      command: { kind: 'toggle' },
    })
    expect(resolveCutEditorCommand(cutterEvent('ArrowLeft', inside))?.source).toBe('mark')
  })

  it('ワークベンチは取らない', () => {
    for (const key of CONTESTED_KEYS) {
      expect(resolveWorkbenchKey(workbenchEvent(key, inside))).toBeNull()
    }
  })

  it('⌘Z はフォーカスがどこでもワークベンチのもの', () => {
    expect(resolveWorkbenchKey({ ...workbenchEvent('z', inside), metaKey: true })).toBe('undo')
  })
})

describe('ボタンやメニュー項目にフォーカスがあるとき', () => {
  const onButton: Situation = { name: 'ボタン', target: button, insideCutEditor: true }
  const onMenuItem: Situation = { name: 'メニュー', target: menuItem, insideCutEditor: true }

  it.each([' ', 'Enter'])('カッターは %s を取らない', (key) => {
    expect(resolveCutEditorCommand(cutterEvent(key, onButton))).toBeNull()
    expect(resolveCutEditorCommand(cutterEvent(key, onMenuItem))).toBeNull()
  })

  it('ワークベンチも取らない', () => {
    expect(resolveWorkbenchKey(workbenchEvent(' ', onButton))).toBeNull()
    expect(resolveWorkbenchKey(workbenchEvent(' ', onMenuItem))).toBeNull()
  })
})
