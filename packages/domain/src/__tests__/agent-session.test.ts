import { describe, expect, it } from 'vitest'
import {
  AGENT_SESSION_UNTITLED,
  AgentApprovalAnswer,
  AgentModel,
  AgentSession,
  AgentSessionId,
  canTransitionAgentSession,
  CreateAgentSessionInput,
  filterAgentSessions,
  newId,
  ProjectId,
  SendAgentMessageInput,
  sessionTitleFrom,
  summaryLineFrom,
  sortAgentSessionsForList,
  UpdateAgentSessionInput,
  type AgentSessionStatus,
} from '../index.js'

/** AI エージェントのタブ（ADR-0058）。会話（タスク）の状態・題名・一覧の並び。 */

const at = (iso: string): Date => new Date(iso)

const session = (over: Partial<AgentSession> = {}): AgentSession => ({
  id: newId(AgentSessionId),
  projectId: newId(ProjectId),
  title: 'テロップを直す',
  model: 'claude-sonnet-5-5',
  cliSessionId: null,
  status: 'idle',
  confirmationsWaived: false,
  costUsd: 0,
  editCount: 0,
  lastSummary: null,
  createdAt: at('2026-10-23T00:00:00Z'),
  lastActiveAt: at('2026-10-23T00:00:00Z'),
  ...over,
})

describe('canTransitionAgentSession', () => {
  const allowed: ReadonlyArray<readonly [AgentSessionStatus, AgentSessionStatus]> = [
    ['idle', 'running'],
    ['running', 'idle'],
    ['running', 'awaiting_approval'],
    ['running', 'interrupted'],
    ['running', 'error'],
    ['awaiting_approval', 'running'],
    ['awaiting_approval', 'interrupted'],
    ['awaiting_approval', 'error'],
    ['interrupted', 'running'],
    ['error', 'running'],
  ]

  it('決めた遷移だけを通す', () => {
    for (const [from, to] of allowed) expect(canTransitionAgentSession(from, to), `${from}→${to}`).toBe(true)
  })

  it('それ以外は通さない（作業中でない会話を止める・確認待ちを飛ばして済みにする、など）', () => {
    const statuses: readonly AgentSessionStatus[] = ['idle', 'running', 'awaiting_approval', 'interrupted', 'error']
    const isAllowed = (from: AgentSessionStatus, to: AgentSessionStatus) =>
      allowed.some(([f, t]) => f === from && t === to)
    for (const from of statuses) {
      for (const to of statuses) {
        if (!isAllowed(from, to)) expect(canTransitionAgentSession(from, to), `${from}→${to}`).toBe(false)
      }
    }
  })
})

describe('sessionTitleFrom', () => {
  it('最初の依頼の 1 行目を題名にする', () => {
    expect(sessionTitleFrom('  0:03 のテロップを「優勝」に  \n理由は…')).toBe('0:03 のテロップを「優勝」に')
  })

  it('長い依頼は 40 文字で切って … を付ける', () => {
    const title = sessionTitleFrom('あ'.repeat(60))
    expect(title).toBe(`${'あ'.repeat(40)}…`)
  })

  it('空白だけなら「新しいタスク」', () => {
    expect(sessionTitleFrom(' \n\t ')).toBe(AGENT_SESSION_UNTITLED)
    expect(AGENT_SESSION_UNTITLED).toBe('新しいタスク')
  })

  it('途中の空白の並びは 1 つにする', () => {
    expect(sessionTitleFrom('効果音を   派手に')).toBe('効果音を 派手に')
  })
})

describe('summaryLineFrom', () => {
  it('返事の最初の行を、Markdown の飾りを外して 120 文字まで', () => {
    expect(summaryLineFrom('\n## 直しました\n0:03 の文言を変えました')).toBe('直しました')
    expect(summaryLineFrom('- **効果音**を 3 本置きました')).toBe('効果音を 3 本置きました')
    expect(summaryLineFrom('あ'.repeat(130))).toBe(`${'あ'.repeat(120)}…`)
  })

  it('空なら null', () => {
    expect(summaryLineFrom('  \n ')).toBeNull()
  })
})

describe('sortAgentSessionsForList', () => {
  it('確認待ちと作業中を上に寄せ、残りは最後に話した順（新しい順）', () => {
    const oldDone = session({ title: '古い済み', lastActiveAt: at('2026-10-20T00:00:00Z') })
    const newDone = session({ title: '新しい済み', lastActiveAt: at('2026-10-23T05:00:00Z') })
    const working = session({ title: '作業中', status: 'running', lastActiveAt: at('2026-10-21T00:00:00Z') })
    const waiting = session({ title: '確認待ち', status: 'awaiting_approval', lastActiveAt: at('2026-10-19T00:00:00Z') })
    const stopped = session({ title: '中断', status: 'interrupted', lastActiveAt: at('2026-10-22T00:00:00Z') })
    const sorted = sortAgentSessionsForList([oldDone, stopped, newDone, waiting, working])
    expect(sorted.map((s) => s.title)).toEqual(['作業中', '確認待ち', '新しい済み', '中断', '古い済み'])
  })

  it('元の配列を並べ替えない', () => {
    const list = [session({ lastActiveAt: at('2026-10-01T00:00:00Z') }), session({ lastActiveAt: at('2026-10-02T00:00:00Z') })]
    const before = list.map((s) => s.id)
    sortAgentSessionsForList(list)
    expect(list.map((s) => s.id)).toEqual(before)
  })
})

describe('filterAgentSessions', () => {
  const list = [
    session({ title: 'テロップを直す', lastSummary: '0:03 の文言を変えました' }),
    session({ title: '効果音', lastSummary: 'CUT-07 に足しました' }),
  ]

  it('題名か、最後の返事の要約に含む会話だけを残す（大文字小文字を区別しない）', () => {
    expect(filterAgentSessions(list, 'テロップ').map((s) => s.title)).toEqual(['テロップを直す'])
    expect(filterAgentSessions(list, 'cut-07').map((s) => s.title)).toEqual(['効果音'])
  })

  it('空の絞り込みなら全部', () => {
    expect(filterAgentSessions(list, '  ')).toHaveLength(2)
  })
})

describe('AgentModel', () => {
  it('モデル ID を受ける', () => {
    expect(AgentModel.safeParse('claude-sonnet-5-5').success).toBe(true)
    expect(AgentModel.safeParse('claude-haiku-4-5-20251001').success).toBe(true)
  })

  it('引数に渡すので、英数字と . - _ 以外は受けない（空白・先頭の - は CLI の引数に化ける）', () => {
    expect(AgentModel.safeParse('--dangerously-skip-permissions').success).toBe(false)
    expect(AgentModel.safeParse('sonnet; rm -rf /').success).toBe(false)
    expect(AgentModel.safeParse('').success).toBe(false)
    expect(AgentModel.safeParse('a'.repeat(101)).success).toBe(false)
  })

  it('別名（sonnet・opus）は受けない（設定によって別のモデルに向く）', () => {
    expect(AgentModel.safeParse('sonnet').success).toBe(false)
    expect(AgentModel.safeParse('opus').success).toBe(false)
  })
})

describe('AgentSession', () => {
  it('題名は 1〜80 文字', () => {
    expect(AgentSession.safeParse(session({ title: '' })).success).toBe(false)
    expect(AgentSession.safeParse(session({ title: 'あ'.repeat(81) })).success).toBe(false)
    expect(AgentSession.safeParse(session({ title: 'あ'.repeat(80) })).success).toBe(true)
  })

  it('費用と直した数は負にならない', () => {
    expect(AgentSession.safeParse(session({ costUsd: -0.01 })).success).toBe(false)
    expect(AgentSession.safeParse(session({ editCount: -1 })).success).toBe(false)
    expect(AgentSession.safeParse(session({ editCount: 1.5 })).success).toBe(false)
  })
})

describe('入力', () => {
  it('話す: 1〜4000 文字。文脈の再生位置は 0 以上の秒', () => {
    expect(SendAgentMessageInput.safeParse({ text: '派手に' }).success).toBe(true)
    expect(SendAgentMessageInput.safeParse({ text: '   ' }).success).toBe(false)
    expect(SendAgentMessageInput.safeParse({ text: 'あ'.repeat(4001) }).success).toBe(false)
    expect(SendAgentMessageInput.safeParse({ text: 'a', context: { playheadSec: -1 } }).success).toBe(false)
    expect(SendAgentMessageInput.safeParse({ text: 'a', context: { shotId: 'not-ulid' } }).success).toBe(false)
    expect(
      SendAgentMessageInput.safeParse({ text: 'a', context: { shotId: newId(AgentSessionId), playheadSec: 3.75 } }).success,
    ).toBe(true)
  })

  it('新しいタスク: モデルは省略できる。別名は受けない', () => {
    expect(CreateAgentSessionInput.safeParse({}).success).toBe(true)
    expect(CreateAgentSessionInput.safeParse({ model: 'sonnet' }).success).toBe(false)
  })

  it('直す: 題名・モデル・確認なしの旗のどれか 1 つは要る', () => {
    expect(UpdateAgentSessionInput.safeParse({}).success).toBe(false)
    expect(UpdateAgentSessionInput.safeParse({ title: '新しい題名' }).success).toBe(true)
    expect(UpdateAgentSessionInput.safeParse({ title: '' }).success).toBe(false)
    expect(UpdateAgentSessionInput.safeParse({ confirmationsWaived: 'yes' }).success).toBe(false)
  })

  it('確認の答え: 実行・やめる。以後確認しないは実行のときだけ', () => {
    expect(AgentApprovalAnswer.safeParse({ decision: 'allow' }).success).toBe(true)
    expect(AgentApprovalAnswer.safeParse({ decision: 'allow', waiveAfter: true }).success).toBe(true)
    expect(AgentApprovalAnswer.safeParse({ decision: 'deny', waiveAfter: true }).success).toBe(false)
    expect(AgentApprovalAnswer.safeParse({ decision: 'maybe' }).success).toBe(false)
  })
})
