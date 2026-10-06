import type { AiSettings } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { aiOptionsFor, initialAiChoice, shouldOfferAiSetup } from '@/lib/ai-setup'
import type { WireAiTool } from '@/lib/ai-settings-api'

/**
 * 使う AI を選ぶ画面（ADR-0032）の中身。**選べるかは API の理由をそのまま使う**（ここで規則を書き写さない）。
 */

const tool = (
  id: WireAiTool['id'],
  status: WireAiTool['status'],
  problems: Partial<WireAiTool['problems']> = {},
): WireAiTool => ({
  id,
  label: id,
  status,
  problems: {
    text: 'まだ使えません',
    image: 'まだ使えません',
    video: 'まだ使えません',
    voice: 'まだ使えません',
    transcribe: 'まだ使えません',
    ...problems,
  },
  notice: null,
})

const TOOLS: readonly WireAiTool[] = [
  tool('stub', { state: 'ready', version: null }, { text: null, image: null, video: null }),
  tool('claude_cli', { state: 'ready', version: '2.1.283' }, { text: null }),
  tool('codex_cli', { state: 'ready', version: '0.154.0' }, { image: null }),
  // 入っているが、まだどの用途にも口が無い。
  tool('grok_cli', { state: 'ready', version: '0.2.102' }),
  // 入っていない（テキストには使えるはずの AI ではない）。
  tool('gemini_cli', { state: 'missing', reason: '入っていません' }),
  tool('local', { state: 'ready', version: null }, { video: null }),
  // 動画に使える AI だが、いまは使えない（理由つきで見せる）。
  tool(
    'vpipe',
    { state: 'missing', reason: '起動していません' },
    { video: '手元の MiniMax H3 を使えません: 起動していません' },
  ),
  // 手元の Wan（ADR-0040）。起動していれば動画に選べる。
  tool('wan', { state: 'ready', version: '0.1.0' }, { video: null }),
]

describe('aiOptionsFor', () => {
  it('その用途に使える AI を、選べるものを先に、選べないものは理由つきで後ろに並べる', () => {
    const { options } = aiOptionsFor('video', TOOLS)

    expect(options.map((option) => [option.id, option.problem === null])).toEqual([
      ['stub', true],
      ['local', true],
      ['wan', true],
      ['vpipe', false],
    ])
    // 行の名前を繰り返さず、理由だけを言う。
    expect(options.find((option) => option.id === 'vpipe')?.problem).toBe('起動していません')
  })

  /**
   * ADR-0040。手元のサーバは 2 台あり、**両方が動画の選択肢に出る**（置き換えではない）。
   * 起動していないものは理由つきで後ろに並ぶ。
   */
  it('手元のサーバ 2 台（MiniMax H3・Wan）がどちらも動画の選択肢に出る', () => {
    const ids = aiOptionsFor('video', TOOLS).options.map((option) => option.id)
    expect(ids).toContain('vpipe')
    expect(ids).toContain('wan')
    // 起動している方は選べる（灰色にしない）。
    expect(aiOptionsFor('video', TOOLS).options.find((o) => o.id === 'wan')?.problem).toBeNull()
  })

  /** 行を埋めずに 1 行で言う（「Claude Code / Codex / Grok は動画には未対応」）。 */
  it('入っているがその用途には使えない AI は、名前だけまとめて返す', () => {
    const { options, installedButUnsupported } = aiOptionsFor('video', TOOLS)

    expect(installedButUnsupported).toEqual(['claude_cli', 'codex_cli', 'grok_cli'])
    expect(options.map((option) => option.id)).not.toContain('claude_cli')
  })

  /** アプリに入っているもの（静止画を動かす）は「入っている AI」ではない。 */
  it('「入っているが使えない」には、外の AI だけを挙げる', () => {
    expect(aiOptionsFor('image', TOOLS).installedButUnsupported).not.toContain('local')
  })

  it('入っておらず、その用途にも使えない AI はどこにも出さない', () => {
    const { options, installedButUnsupported } = aiOptionsFor('image', TOOLS)

    expect([...options.map((option) => option.id), ...installedButUnsupported]).not.toContain(
      'gemini_cli',
    )
  })

  it('版を添える', () => {
    expect(
      aiOptionsFor('text', TOOLS).options.find((option) => option.id === 'claude_cli')?.version,
    ).toBe('2.1.283')
  })
})

describe('aiOptionsFor: 入っているが使えない AI', () => {
  /**
   * 「入っているが、この用途には使えない」は、この Mac に入れた AI の CLI のことだけを言う（ADR-0038）。
   * Mac の声（OS の道具）・whisper.cpp・鍵で使う API は「入れた AI」ではないので、ほかの用途の欄に挙げない。
   */
  it('Mac の声・whisper.cpp・Gemini の API は、動画の欄に挙げない', () => {
    const tools = [
      ...TOOLS,
      tool('macos_say', { state: 'ready', version: null }, { voice: null }),
      tool('whisper_cpp', { state: 'ready', version: null }, { transcribe: null }),
      tool('gemini_api', { state: 'ready', version: null }, { voice: null, transcribe: null }),
    ]

    expect(aiOptionsFor('video', tools).installedButUnsupported).toEqual(['claude_cli', 'codex_cli', 'grok_cli'])
  })
})

describe('initialAiChoice', () => {
  const recommended: AiSettings = { text: 'claude_cli', image: 'codex_cli', video: 'local', voice: 'macos_say', transcribe: 'stub' }
  const current: AiSettings = { text: 'stub', image: 'stub', video: 'stub', voice: 'stub', transcribe: 'stub' }

  it('まだ選んでいなければ勧める組み合わせから始める', () => {
    expect(initialAiChoice({ settings: current, source: 'default' }, recommended)).toEqual(
      recommended,
    )
  })

  it('選んであればその選択から始める', () => {
    expect(initialAiChoice({ settings: current, source: 'saved' }, recommended)).toEqual(current)
  })
})

describe('shouldOfferAiSetup', () => {
  it('まだ選んでおらず、この画面でまだ勧めていなければ開く', () => {
    expect(shouldOfferAiSetup('default', false)).toBe(true)
  })

  it('選んであれば開かない', () => {
    expect(shouldOfferAiSetup('saved', false)).toBe(false)
  })

  /** 初回だけ。閉じたあとはメニュー「使う AI…」から開く（開くたびに出てこない）。 */
  it('一度勧めたら、選ばずに閉じても次からは開かない', () => {
    expect(shouldOfferAiSetup('default', true)).toBe(false)
  })
})
