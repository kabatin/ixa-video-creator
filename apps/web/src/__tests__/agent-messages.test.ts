import { describe, expect, it } from 'vitest'
import {
  AGENT_STATUS_LABELS,
  AGENT_TOOL_LABELS,
  agentItemsFrom,
  mergeAgentMessages,
  scrubInternal,
  toolLabel,
} from '@/lib/agent-messages'
import type { WireAgentMessage } from '@/lib/agent-api'

/** AI エージェントのタブ（ADR-0058）。会話の行を画面に出す形にする。内部 ID は出さない。 */

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0'
const at = '2026-10-23T06:00:00.000Z'
const msg = (seq: number, body: WireAgentMessage['body']): WireAgentMessage => ({ seq, body, createdAt: at })

describe('mergeAgentMessages', () => {
  it('通し番号の順に並べ、同じ番号は 1 つにする（取りこぼしを埋め直しても重ならない）', () => {
    const a = msg(1, { kind: 'assistant_text', text: 'a' })
    const b = msg(2, { kind: 'assistant_text', text: 'b' })
    const c = msg(3, { kind: 'assistant_text', text: 'c' })
    expect(mergeAgentMessages([a, c], [b, c]).map((m) => m.seq)).toEqual([1, 2, 3])
  })

  it('元の配列を変えない', () => {
    const list = [msg(2, { kind: 'assistant_text', text: 'b' })]
    mergeAgentMessages(list, [msg(1, { kind: 'assistant_text', text: 'a' })])
    expect(list.map((m) => m.seq)).toEqual([2])
  })
})

describe('agentItemsFrom', () => {
  it('ツールの呼び出しと結果を 1 行にまとめる（作っている → 済み・失敗）', () => {
    const items = agentItemsFrom([
      msg(1, { kind: 'user', text: '効果音を', context: { shotLabel: 'CUT-07', playheadSec: 3 } }),
      msg(2, { kind: 'tool_call', toolUseId: 't1', toolName: 'mcp__ixa__generate_sfx', input: { projectId: ULID, cues: [{}, {}, {}] } }),
      msg(3, { kind: 'tool_call', toolUseId: 't2', toolName: 'mcp__ixa__list_sfx', input: { projectId: ULID } }),
      msg(4, { kind: 'tool_result', toolUseId: 't1', isError: false, text: `{"jobIds":["${ULID}"]}` }),
      msg(5, { kind: 'assistant_text', text: '置きました' }),
    ])
    expect(items.map((i) => i.kind)).toEqual(['user', 'tool', 'tool', 'assistant'])
    const [, sfx, list] = items
    expect(sfx).toMatchObject({ kind: 'tool', state: 'done', title: '効果音を 3 本作った' })
    expect(list).toMatchObject({ kind: 'tool', state: 'running', title: '効果音の一覧を読んでいる' })
  })

  it('失敗した操作は、何をしていて失敗したかを言う', () => {
    const [tool] = agentItemsFrom([
      msg(1, { kind: 'tool_call', toolUseId: 't1', toolName: 'mcp__ixa__generate_sfx', input: { cues: [{}] } }),
      msg(2, { kind: 'tool_result', toolUseId: 't1', isError: true, text: '制作者がやめました' }),
    ])
    expect(tool).toMatchObject({ state: 'failed', title: '効果音を 1 本作っていたが、うまくいかなかった' })
  })

  it('中身の要約から内部 ID を外す', () => {
    const [tool] = agentItemsFrom([
      msg(1, { kind: 'tool_call', toolUseId: 't1', toolName: 'mcp__ixa__generate_sfx', input: { projectId: ULID, shotIds: [ULID], cues: [{ prompt: 'boom' }] } }),
      msg(2, { kind: 'tool_result', toolUseId: 't1', isError: false, text: `{"jobIds":["${ULID}"],"url":"https://x.test/a?sig=1"}` }),
    ])
    expect(JSON.stringify(tool)).not.toContain(ULID)
    expect(JSON.stringify(tool)).not.toContain('https://')
    expect(JSON.stringify(tool)).toContain('boom')
  })

  it('確認のカードは答えるまで「待っている」。答えたら、実行・やめたが分かる', () => {
    const request = msg(2, {
      kind: 'approval_request',
      requestId: ULID,
      toolUseId: 't1',
      toolName: 'mcp__ixa__generate_sfx',
      risk: 'costly',
      input: { cues: [{}] },
    })
    expect(agentItemsFrom([request])[0]).toMatchObject({ kind: 'approval', state: 'pending', title: '効果音を 1 本作ります' })
    const answered = agentItemsFrom([request, msg(3, { kind: 'approval_decision', requestId: ULID, decision: 'deny', waiveAfter: false })])
    expect(answered[0]).toMatchObject({ kind: 'approval', state: 'denied' })
  })

  it('期限切れでやめた確認は、そう分かる', () => {
    const request = msg(2, {
      kind: 'approval_request',
      requestId: ULID,
      toolUseId: 't1',
      toolName: 'mcp__ixa__export',
      risk: 'costly',
      input: {},
    })
    const items = agentItemsFrom([request, msg(3, { kind: 'approval_decision', requestId: ULID, decision: 'deny', waiveAfter: false, by: 'timeout' })])
    expect(items[0]).toMatchObject({ kind: 'approval', state: 'timedOut' })
  })

  it('答える前にやりとりが終わった確認（止めた・API の再起動）は、もう押せない（「終わった」）', () => {
    const request = msg(2, {
      kind: 'approval_request',
      requestId: ULID,
      toolUseId: 't1',
      toolName: 'mcp__ixa__generate_sfx',
      risk: 'costly',
      input: { cues: [{}] },
    })
    for (const after of [
      msg(3, { kind: 'system', event: 'interrupted', text: '途中で止まりました', raw: null }),
      msg(3, { kind: 'turn_end', isError: false, text: null, costUsd: 0, durationSec: 1 }),
      msg(3, { kind: 'user', text: '続き', context: null }),
    ]) {
      expect(agentItemsFrom([request, after])[0]).toMatchObject({ kind: 'approval', state: 'expired' })
    }
  })

  it('結果が来ないままやりとりが終わった操作は「途中で止まった」にする（作っている、のまま残さない）', () => {
    const [tool] = agentItemsFrom([
      msg(1, { kind: 'tool_call', toolUseId: 't1', toolName: 'mcp__ixa__generate_sfx', input: { cues: [{}] } }),
      msg(2, { kind: 'system', event: 'interrupted', text: '止めました', raw: null }),
    ])
    expect(tool).toMatchObject({ state: 'failed', title: '効果音を 1 本作っていたが、途中で止まった' })
  })

  it('知らない行・CLI の始まりは出さない。確認なし・中断・失敗は知らせの行にする', () => {
    const items = agentItemsFrom([
      msg(1, { kind: 'system', event: 'cli_init', text: 'claude-sonnet-5-5', raw: null }),
      msg(2, { kind: 'system', event: 'unknown_line', text: null, raw: { type: 'rate_limit_event' } }),
      msg(3, { kind: 'system', event: 'confirmations_waived', text: 'このタスクでは確認を出さずに進めます。', raw: null }),
      msg(4, { kind: 'system', event: 'failed', text: '途中で終わりました', raw: null }),
      msg(5, { kind: 'turn_end', isError: false, text: 'done', costUsd: 0.1, durationSec: 3 }),
    ])
    expect(items).toEqual([
      { kind: 'notice', seq: 3, tone: 'info', text: 'このタスクでは確認を出さずに進めます。' },
      { kind: 'notice', seq: 4, tone: 'danger', text: '途中で終わりました' },
    ])
  })

  it('approve 自身の呼び出しは出さない', () => {
    expect(
      agentItemsFrom([msg(1, { kind: 'tool_call', toolUseId: 't', toolName: 'mcp__ixa__approve', input: {} })]),
    ).toEqual([])
  })
})

describe('toolLabel', () => {
  it('ixa のツールは全部、日本語の言い方を持つ', () => {
    const names = [
      'ixa_status', 'set_ai', 'create_project', 'get_project', 'generate_music', 'upload_music', 'set_master_track',
      'music_overview', 'plan_shots', 'edit_shots', 'create_character', 'create_location', 'draw_start_frames',
      'set_start_frame', 'list_start_frame_history', 'use_start_frame', 'retry_image', 'view', 'generate_takes',
      'list_takes', 'adopt_take', 'review_take', 'upscale_takes', 'wait', 'add_effects', 'list_effects', 'remove_effects',
      'analyze_motion', 'suggest_sfx', 'generate_sfx', 'list_sfx', 'remove_sfx', 'export', 'export_thumbnail',
      'waive_confirmations',
    ]
    expect(Object.keys(AGENT_TOOL_LABELS).sort()).toEqual([...names].sort())
  })

  it('どのツールも確認のカードの言い方（〜ます）を持つ（作品の外を触る読み取りも確認に回るため）', () => {
    expect(toolLabel('mcp__ixa__get_project', {}).ask).toBe('作品を読みます')
    for (const [name, spec] of Object.entries(AGENT_TOOL_LABELS)) {
      expect(spec.ask, name).toMatch(/(ます|か)(（.*）)?$/)
    }
  })

  it('知らないツールは名前を出さず「操作」と言う', () => {
    expect(toolLabel('Bash', {})).toEqual({ doing: '操作している', done: '操作した', ask: '操作を実行します' })
  })
})

describe('scrubInternal', () => {
  it('ULID と URL を伏せ、長い文は切る', () => {
    expect(scrubInternal(`id ${ULID} at https://a.test/x`)).toBe('id … at …')
    expect(scrubInternal('あ'.repeat(500)).length).toBeLessThanOrEqual(301)
  })
})

describe('AGENT_STATUS_LABELS', () => {
  it('状態の印は 作業中・確認待ち・済み・中断', () => {
    expect(AGENT_STATUS_LABELS).toEqual({
      running: '作業中',
      awaiting_approval: '確認待ち',
      idle: '済み',
      interrupted: '中断',
      error: '中断',
    })
  })
})
