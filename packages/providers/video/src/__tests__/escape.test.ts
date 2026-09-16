import { describe, expect, it } from 'vitest'
import {
  escapeDrawtextExpression,
  escapeDrawtextText,
  escapeForFilterArgs,
  escapeForFilterGraph,
  escapeForTextExpansion,
} from '../stub/escape.js'

describe('escapeForTextExpansion', () => {
  it('% と \\ だけを保護する', () => {
    expect(escapeForTextExpansion('100%')).toBe(String.raw`100\%`)
    expect(escapeForTextExpansion('a\\b')).toBe(String.raw`a\\b`)
    expect(escapeForTextExpansion('a:b')).toBe('a:b')
  })
})

describe('escapeForFilterArgs', () => {
  it('オプション区切りの : と = を保護する', () => {
    expect(escapeForFilterArgs('a:b')).toBe(String.raw`a\:b`)
    expect(escapeForFilterArgs('a=b')).toBe(String.raw`a\=b`)
  })
})

describe('escapeForFilterGraph', () => {
  it('フィルタ区切りの , ; [ ] を保護する', () => {
    expect(escapeForFilterGraph('a,b')).toBe(String.raw`a\,b`)
    expect(escapeForFilterGraph('a;b')).toBe(String.raw`a\;b`)
    expect(escapeForFilterGraph('[a]')).toBe(String.raw`\[a\]`)
  })
})

describe('escapeDrawtextText', () => {
  it('普通の文字列はそのまま通す', () => {
    expect(escapeDrawtextText('shot 01ARZ3ND')).toBe('shot 01ARZ3ND')
  })

  it('空文字は空文字のまま', () => {
    expect(escapeDrawtextText('')).toBe('')
  })

  it('日本語をそのまま通す', () => {
    expect(escapeDrawtextText('たけぴが勝利する')).toBe('たけぴが勝利する')
  })

  it(': は 3 段のパースを抜けて 1 つのコロンになる', () => {
    // filtergraph → filter 引数 の 2 段で 1 枚ずつ剥がれる
    expect(escapeDrawtextText(':')).toBe(String.raw`\\:`)
  })

  it("' は 3 段分エスケープされる", () => {
    expect(escapeDrawtextText("'")).toBe(String.raw`\\\'`)
  })

  it('% は展開レベルで literal 化され、外側 2 段で更に保護される', () => {
    expect(escapeDrawtextText('%')).toBe(String.raw`\\\\%`)
  })

  it('\\ は 1 段ごとに倍になる', () => {
    expect(escapeDrawtextText('\\')).toBe('\\'.repeat(8))
  })

  it('%{pts} のような展開はテキストとして無害化される', () => {
    expect(escapeDrawtextText('%{pts}')).toBe(String.raw`\\\\%{pts}`)
  })

  it('混在した記号をすべて処理する', () => {
    expect(escapeDrawtextText("a:b'c%d")).toBe(String.raw`a\\:b\\\'c\\\\%d`)
  })
})

describe('escapeDrawtextExpression', () => {
  it('%{...} を生かしたまま : だけを保護する', () => {
    expect(escapeDrawtextExpression('%{pts:hms}')).toBe(String.raw`%{pts\\:hms}`)
  })

  it('展開式とリテラルを混ぜられる', () => {
    expect(escapeDrawtextExpression('%{pts:hms} | frame %{n}')).toBe(
      String.raw`%{pts\\:hms} | frame %{n}`,
    )
  })
})
