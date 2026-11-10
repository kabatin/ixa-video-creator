import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmptyState, describeViewState, type ViewStateKind } from '@/components/empty-state'

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

describe('EmptyState の補足', () => {
  const markup = (hint: string | readonly string[]) =>
    renderToStaticMarkup(
      createElement(EmptyState, { message: 'プロジェクトがありません', actionHref: '/new', actionLabel: '作成', hint }),
    )

  it('1 行の補足はそのまま 1 段で出す', () => {
    expect(markup('まだ 1 件もありません。').match(/<p /g)).toHaveLength(2)
  })

  it('行を並べて渡すと、1 行ずつ別の段で出す（順番どおり）', () => {
    const html = markup(['一つ目の行', '二つ目の行', '三つ目の行'])
    expect(html.match(/<li/g)).toHaveLength(3)
    expect(html.indexOf('一つ目の行')).toBeLessThan(html.indexOf('二つ目の行'))
    expect(html.indexOf('二つ目の行')).toBeLessThan(html.indexOf('三つ目の行'))
  })
})
