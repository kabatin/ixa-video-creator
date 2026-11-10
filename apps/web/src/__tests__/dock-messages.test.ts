import { resolveMessages } from 'dockview-react'
import { describe, expect, it } from 'vitest'
import { DOCK_MESSAGES } from '@/lib/dock-messages'

/** 項目ごとの引数の見本。パネル名は日本語（画面と同じ）。 */
const SAMPLES: Readonly<Record<string, readonly unknown[]>> = {
  movePickTarget: ['素材ツリー', 'プレビュー', 2, 5],
  movePickEdge: ['left', 'プレビュー'],
  moveCommitted: ['素材ツリー', 'プレビュー', 'center'],
}

const say = (catalog: object, key: string): string => {
  const fn = (catalog as Record<string, (...args: readonly unknown[]) => string>)[key]
  if (fn === undefined) throw new Error(`${key} がありません`)
  return fn(...(SAMPLES[key] ?? ['素材ツリー']))
}

describe('ドックの読み上げ', () => {
  it('タブの閉じるボタンと、開け閉めの読み上げは日本語', () => {
    expect(DOCK_MESSAGES.closeTab('素材ツリー')).toBe('素材ツリーを閉じる')
    expect(DOCK_MESSAGES.panelOpened('プレビュー')).toBe('プレビューを開きました')
    expect(DOCK_MESSAGES.movePickEdge('center', 'プレビュー')).toContain('プレビューと同じ枠のタブに置きます')
    expect(DOCK_MESSAGES.moveCommitted('素材ツリー', 'プレビュー', 'bottom')).toBe('素材ツリーをプレビューの下に置きました。')
  })

  /**
   * 部品の既定（英語）の項目を 1 つ残らず差し替えている。
   * 部品の版が上がって項目が増えると、ここで落ちて気づける（英語のまま画面に出る前に）。
   */
  it('部品の既定にある項目をすべて持ち、英字を出さない', () => {
    const defaults = resolveMessages()
    const keys = Object.keys(defaults)
    expect(Object.keys(DOCK_MESSAGES).sort()).toEqual([...keys].sort())
    expect(keys.filter((key) => /[A-Za-z]/.test(say(DOCK_MESSAGES, key)))).toEqual([])
    // 検査そのものが効いていること: 既定は英語なので、同じ検査で全部引っ掛かる。
    expect(keys.filter((key) => /[A-Za-z]/.test(say(defaults, key)))).toEqual(keys)
  })
})
