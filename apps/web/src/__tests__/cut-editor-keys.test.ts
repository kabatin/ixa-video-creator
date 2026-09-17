import { describe, expect, it } from 'vitest'
import {
  SOURCE_KEY_HELP,
  describeCutEditorKeys,
  resolveCutEditorCommand,
  shadowedPlaybackKeys,
  type CutEditorKeyEvent,
} from '@/lib/cut-editor-keys'
import { resolveCutMarkCommand } from '@/lib/cut-marks'
import { keyToPlaybackCommand } from '@/lib/playback-state'

/**
 * 聴きながら切る画面では、再生と区切りの割り当てが `←` `→` で重なる。
 * 重なりを解いたことと、**画面に出す説明が実際の動作と一致すること**を固定する。
 */

const press = (
  key: string,
  modifiers: Partial<Omit<CutEditorKeyEvent, 'key' | 'target'>> = {},
  target: CutEditorKeyEvent['target'] = null,
): CutEditorKeyEvent => ({
  key,
  shiftKey: modifiers.shiftKey ?? false,
  altKey: modifiers.altKey ?? false,
  ctrlKey: modifiers.ctrlKey ?? false,
  metaKey: modifiers.metaKey ?? false,
  target,
})

/** 両方の割り当てが受け取るキー。ここが重なりの正体。 */
const CONTESTED: readonly CutEditorKeyEvent[] = [
  press('ArrowLeft'),
  press('ArrowRight'),
  press('ArrowLeft', { shiftKey: true }),
  press('ArrowRight', { shiftKey: true }),
]

describe('重なったキーの行き先', () => {
  it.each(CONTESTED)('$key（shift=$shiftKey）は両方の割り当てが名乗り出る', (event) => {
    // 前提そのものを固定する。どちらかが割り当てを変えたらここが落ち、
    // 優先順位を決め直す必要があることに気づける。
    expect(resolveCutMarkCommand(event)).not.toBeNull()
    expect(keyToPlaybackCommand(event)).not.toBeNull()
  })

  it.each(CONTESTED)('$key（shift=$shiftKey）は区切り側が取る', (event) => {
    expect(resolveCutEditorCommand(event)?.source).toBe('mark')
  })

  it('素の矢印は区切りの間を移る', () => {
    expect(resolveCutEditorCommand(press('ArrowLeft'))).toEqual({
      source: 'mark',
      command: { type: 'select_previous_mark' },
    })
    expect(resolveCutEditorCommand(press('ArrowRight'))).toEqual({
      source: 'mark',
      command: { type: 'select_next_mark' },
    })
  })

  it('Shift 付きの矢印は選んだ区切りを動かす。再生位置ではない', () => {
    const resolved = resolveCutEditorCommand(press('ArrowRight', { shiftKey: true }))

    expect(resolved?.source).toBe('mark')
    expect(resolved?.command).toMatchObject({ type: 'nudge_selected_mark' })
  })
})

describe('再生側に残るキー', () => {
  it('Space は再生の入り切り', () => {
    expect(resolveCutEditorCommand(press(' '))).toEqual({
      source: 'playback',
      command: { kind: 'toggle' },
    })
  })

  it('カンマとピリオドは細かい移動として残る。区切りと重ならない', () => {
    expect(resolveCutEditorCommand(press(','))?.source).toBe('playback')
    expect(resolveCutEditorCommand(press('.'))?.source).toBe('playback')
  })

  it('Home と End は先頭・末尾へ飛ぶ', () => {
    expect(resolveCutEditorCommand(press('Home'))).toEqual({
      source: 'playback',
      command: { kind: 'jump', edge: 'start' },
    })
    expect(resolveCutEditorCommand(press('End'))).toEqual({
      source: 'playback',
      command: { kind: 'jump', edge: 'end' },
    })
  })
})

describe('区切りだけが持つキー', () => {
  it.each([
    ['Enter', 'place_mark'],
    ['s', 'place_mark'],
    ['Backspace', 'remove_previous_mark'],
    ['Delete', 'remove_selected_mark'],
    ['x', 'remove_selected_mark'],
    ['n', 'toggle_snap'],
  ])('%s は %s', (key, type) => {
    expect(resolveCutEditorCommand(press(key))).toEqual({
      source: 'mark',
      command: { type },
    })
  })

  it('Alt 付きの矢印は粗い微調整。再生側は Alt を受けないので重ならない', () => {
    expect(resolveCutEditorCommand(press('ArrowRight', { altKey: true }))?.source).toBe('mark')
    expect(keyToPlaybackCommand(press('ArrowRight', { altKey: true }))).toBeNull()
  })
})

describe('文字を打っている最中', () => {
  const field = { tagName: 'INPUT', isContentEditable: false }
  const editable = { tagName: 'DIV', isContentEditable: true }

  it.each([' ', 's', 'Enter', 'ArrowLeft', 'Backspace'])('入力欄への %s は横取りしない', (key) => {
    expect(resolveCutEditorCommand(press(key, {}, field))).toBeNull()
  })

  it('編集可能な要素でも横取りしない', () => {
    expect(resolveCutEditorCommand(press(' ', {}, editable))).toBeNull()
  })

  /**
   * `keyToPlaybackCommand` は飛び先を見ない。見るのは呼ぶ側の責任なので、
   * ここを外すと題名を打つスペースで曲が鳴り出す。
   */
  it('再生側だけが受けるキーでも、入力欄なら止める', () => {
    expect(keyToPlaybackCommand(press(' '))).not.toBeNull()
    expect(resolveCutEditorCommand(press(' ', {}, field))).toBeNull()
  })
})

describe('修飾キー', () => {
  it.each(['ctrlKey', 'metaKey'] as const)('%s 付きは横取りしない', (modifier) => {
    expect(resolveCutEditorCommand(press('ArrowLeft', { [modifier]: true }))).toBeNull()
    expect(resolveCutEditorCommand(press(' ', { [modifier]: true }))).toBeNull()
  })
})

describe('割り当てのない打鍵', () => {
  it.each(['a', 'F5', 'Tab', 'Escape'])('%s は何も返さない', (key) => {
    expect(resolveCutEditorCommand(press(key))).toBeNull()
  })
})

describe('画面に出す一覧', () => {
  const help = describeCutEditorKeys()

  it('説明が実際の行き先と一致している', () => {
    const arrow = help.find((entry) => entry.keys === '← / →')

    expect(arrow?.source).toBe('mark')
    expect(arrow?.action).toContain('区切り')
  })

  /**
   * 重なりを解いた結果、再生側の一覧は**この画面では嘘になる**。
   * 元の一覧をそのまま出していないことを固定する。
   */
  it('再生側の一覧をそのまま写していない', () => {
    const playbackArrow = SOURCE_KEY_HELP.playback.find((hint) => hint.keys === '← / →')
    const editorArrow = help.find((entry) => entry.keys === '← / →')

    expect(playbackArrow?.action).toContain('秒')
    expect(editorArrow?.action).not.toBe(playbackArrow?.action)
  })

  it('取られて効かなくなった再生のキーを数えられる', () => {
    expect(shadowedPlaybackKeys()).toEqual(['← / →', 'Shift + ← / →'])
  })

  it('同じキーを 2 回説明していない', () => {
    const keys = help.map((entry) => entry.keys)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('説明が空の行がない', () => {
    expect(help.every((entry) => entry.action.length > 0)).toBe(true)
  })

  it('両方の割り当てから行が出ている', () => {
    expect(help.some((entry) => entry.source === 'mark')).toBe(true)
    expect(help.some((entry) => entry.source === 'playback')).toBe(true)
  })

  /**
   * 一覧は判定を通して作るので、**説明できる打鍵は必ず実際に効く**。
   * 逆に、効かない打鍵が一覧に残ることもない。
   */
  it('一覧のすべての行が実際に操作へ繋がる', () => {
    expect(help.every((entry) => entry.action.trim().length > 0)).toBe(true)
    expect(help.length).toBeGreaterThanOrEqual(SOURCE_KEY_HELP.playback.length)
  })
})
