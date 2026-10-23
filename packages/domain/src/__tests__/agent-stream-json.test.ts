import { describe, expect, it } from 'vitest'
import { AgentMessageBody, parseStreamJsonLine, type AgentMessageBody as Body } from '../index.js'
import { ALLOW_AND_DENY, RESUME, UNKNOWN_MODEL } from './fixtures/claude-stream-json.js'

/**
 * Claude CLI の `--output-format stream-json --verbose` の 1 行を、会話の行に変える（ADR-0058）。
 * fixture は CLI 2.1.289 を実際に流した出力（`fixtures/claude-stream-json.ts`）。
 */

const parseAll = (lines: readonly string[]) => lines.map((line) => parseStreamJsonLine(line))
const bodies = (lines: readonly string[]): readonly Body[] => parseAll(lines).flatMap((r) => r.bodies)

describe('parseStreamJsonLine（実物の出力）', () => {
  const lines = ALLOW_AND_DENY

  it('init の行から CLI の会話 ID を取る', () => {
    const first = parseStreamJsonLine(lines[0] ?? '')
    expect(first.cliSessionId).toBe('6a4a65e2-1d81-49ef-add0-13d11b944480')
    expect(first.bodies).toEqual([{ kind: 'system', event: 'cli_init', text: 'claude-sonnet-5-5', raw: null }])
  })

  it('ツールの呼び出し・結果・返事・終わりを順に並べる', () => {
    const kinds = bodies(lines)
      .filter((b) => b.kind !== 'system')
      .map((b) => b.kind)
    expect(kinds).toEqual(['tool_call', 'tool_result', 'tool_call', 'tool_result', 'assistant_text', 'turn_end'])
  })

  it('ツールの呼び出しは ID・名前・頼んだ中身を持つ', () => {
    const calls = bodies(lines).filter((b) => b.kind === 'tool_call')
    expect(calls[1]).toEqual({
      kind: 'tool_call',
      toolUseId: 'toolu_019SJ547iEVUZ5jmLSbKGWTU',
      toolName: 'mcp__ixa__delete_note',
      input: { why: 'test' },
    })
  })

  it('結果は文字にする。断られた結果は失敗の印が付く', () => {
    const results = bodies(lines).filter((b) => b.kind === 'tool_result')
    expect(results[0]).toEqual({
      kind: 'tool_result',
      toolUseId: 'toolu_01KKvV936ZR3GVMt99SAi1CF',
      isError: false,
      text: 'note says: hello',
    })
    expect(results[1]).toMatchObject({ isError: true, text: '制作者がやめました' })
  })

  it('終わりの行から、成否・費用・時間（秒）を取る', () => {
    const end = bodies(lines).find((b) => b.kind === 'turn_end')
    expect(end).toMatchObject({ kind: 'turn_end', isError: false, costUsd: 0.0061956, durationSec: 5.18 })
    expect(end?.kind === 'turn_end' ? end.text : null).toContain('hello')
  })

  it('知らない行（rate_limit_event）も捨てずに system として残す', () => {
    const unknown = bodies(lines).filter((b) => b.kind === 'system' && b.event === 'unknown_line')
    expect(unknown).toHaveLength(1)
    expect(unknown[0]).toMatchObject({ raw: { type: 'rate_limit_event' } })
  })

  it('どの行も、会話の行の形（zod）を満たす', () => {
    for (const body of bodies(lines)) expect(AgentMessageBody.safeParse(body).success).toBe(true)
  })
})

describe('parseStreamJsonLine（続きから話した回）', () => {
  it('--resume しても会話 ID は同じものが返る', () => {
    const ids = parseAll(RESUME).map((r) => r.cliSessionId)
    expect(new Set(ids.filter((id) => id !== null))).toEqual(new Set(['6a4a65e2-1d81-49ef-add0-13d11b944480']))
  })
})

describe('parseStreamJsonLine（失敗）', () => {
  it('subtype が success でも is_error なら失敗として終わる', () => {
    const end = bodies(UNKNOWN_MODEL).find((b) => b.kind === 'turn_end')
    expect(end).toMatchObject({ kind: 'turn_end', isError: true, costUsd: 0 })
    expect(end?.kind === 'turn_end' ? end.text : null).toContain('claude-nope-9')
  })

  it('JSON でない行は system（unparsable）として残す', () => {
    const result = parseStreamJsonLine('not json {')
    expect(result.cliSessionId).toBeNull()
    expect(result.bodies).toEqual([{ kind: 'system', event: 'unparsable', text: 'not json {', raw: null }])
  })

  it('空の行は何も返さない', () => {
    expect(parseStreamJsonLine('   ').bodies).toEqual([])
  })

  it('長い結果は切り詰める（会話の行を太らせない）', () => {
    const line = JSON.stringify({
      type: 'user',
      session_id: 's',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(10_000) }] },
    })
    const [body] = parseStreamJsonLine(line).bodies
    expect(body?.kind).toBe('tool_result')
    if (body?.kind === 'tool_result') expect(body.text.length).toBeLessThanOrEqual(2001)
  })

  it('assistant の知らない種類の部分（thinking など）も system として残す', () => {
    const line = JSON.stringify({
      type: 'assistant',
      session_id: 's',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: 'はい' }] },
    })
    expect(parseStreamJsonLine(line).bodies.map((b) => b.kind)).toEqual(['system', 'assistant_text'])
  })
})

describe('AgentMessageBody', () => {
  it('知らない種類は受けない', () => {
    expect(AgentMessageBody.safeParse({ kind: 'shell', text: 'ls' }).success).toBe(false)
  })

  it('費用は負にならない・時間は秒で 0 以上', () => {
    const end = { kind: 'turn_end', isError: false, text: null, costUsd: 0, durationSec: 0 }
    expect(AgentMessageBody.safeParse(end).success).toBe(true)
    expect(AgentMessageBody.safeParse({ ...end, costUsd: -1 }).success).toBe(false)
    expect(AgentMessageBody.safeParse({ ...end, durationSec: -1 }).success).toBe(false)
  })
})
