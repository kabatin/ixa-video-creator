import { describe, expect, it } from 'vitest'
import { parseAgentText } from '@/lib/agent-text'

/** エージェントの返事（Markdown の小さな部分集合）を、整形した文章の塊にする（ADR-0058）。HTML は作らない。 */
describe('parseAgentText', () => {
  it('見出し・段落・箇条書き・番号付き・コードを分ける', () => {
    expect(
      parseAgentText('## 直しました\n0:03 の文言を\n変えました。\n\n- 効果音\n- テロップ\n\n1. 一つ目\n2. 二つ目\n\n```\nraw\n```'),
    ).toEqual([
      { kind: 'heading', inline: [{ kind: 'text', text: '直しました' }] },
      { kind: 'paragraph', inline: [{ kind: 'text', text: '0:03 の文言を\n変えました。' }] },
      { kind: 'list', ordered: false, items: [[{ kind: 'text', text: '効果音' }], [{ kind: 'text', text: 'テロップ' }]] },
      { kind: 'list', ordered: true, items: [[{ kind: 'text', text: '一つ目' }], [{ kind: 'text', text: '二つ目' }]] },
      { kind: 'code', text: 'raw' },
    ])
  })

  it('太字とコードを文の中で分ける', () => {
    expect(parseAgentText('**CUT-07** に `boom` を')).toEqual([
      {
        kind: 'paragraph',
        inline: [
          { kind: 'strong', text: 'CUT-07' },
          { kind: 'text', text: ' に ' },
          { kind: 'code', text: 'boom' },
          { kind: 'text', text: ' を' },
        ],
      },
    ])
  })

  it('HTML の札はただの文字のまま（解釈しない）', () => {
    expect(parseAgentText('<b>x</b>')).toEqual([{ kind: 'paragraph', inline: [{ kind: 'text', text: '<b>x</b>' }] }])
  })

  it('空なら何も無い', () => {
    expect(parseAgentText('  \n ')).toEqual([])
  })
})
