import { describe, expect, it } from 'vitest'
import { describeViewState, type ViewStateKind } from '@/components/empty-state'

const KINDS: readonly ViewStateKind[] = ['missing', 'empty', 'unreadable', 'loading']

/**
 * 「無い」「空」「読めなかった」「読み込み中」を混ぜないことを構造で守る。
 *
 * 以前 Shot 一覧は「Project が無い」を「Shot が 0 件」に畳んでいて、
 * 存在しない Project が「最初の Shot を作成」に見えた（lessons L-015）。
 */
describe('画面の状態', () => {
  it('4 つの状態が同じ言葉にならない', () => {
    const titles = KINDS.map((kind) => describeViewState(kind, 'Shot').title)
    expect(new Set(titles).size).toBe(KINDS.length)
  })

  it('4 つの状態が同じ補足にならない', () => {
    const hints = KINDS.map((kind) => describeViewState(kind, 'Shot').hint)
    expect(new Set(hints).size).toBe(KINDS.length)
  })

  it('「無い」と「空」を別の言葉で出す', () => {
    expect(describeViewState('missing', 'プロジェクト').title).toBe('プロジェクトが見つかりません')
    expect(describeViewState('empty', 'Shot').title).toBe('Shot がありません')
  })

  it('異常だけを alert にする', () => {
    expect(describeViewState('missing', 'プロジェクト').role).toBe('alert')
    expect(describeViewState('unreadable', 'Shot').role).toBe('alert')
    expect(describeViewState('empty', 'Shot').role).toBe('status')
    expect(describeViewState('loading', 'ページ').role).toBe('status')
  })

  it('英数字で終わる語のあとにだけ空白を入れる', () => {
    expect(describeViewState('unreadable', 'Shot').title).toBe('Shot を読み込めませんでした')
    expect(describeViewState('unreadable', 'プロジェクト').title).toBe(
      'プロジェクトを読み込めませんでした',
    )
  })

  it('返す値を書き換えられない', () => {
    const state = describeViewState('empty', 'Shot')
    expect(Object.isFrozen(state)).toBe(true)
  })
})
