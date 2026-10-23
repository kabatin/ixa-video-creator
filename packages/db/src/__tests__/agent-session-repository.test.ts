import { getTableConfig } from 'drizzle-orm/pg-core'
import { AgentSessionId, ProjectId, newId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  agentMessageRowToDomain,
  agentSessionRowToDomain,
  type AgentMessageRow,
  type AgentSessionRow,
} from '../repositories/agent-session-repository.js'
import { agentMessages, agentSessions } from '../schema/agent.js'

/** AI エージェントの会話（ADR-0058）の行 → Domain。壊れた行を黙って読み替えない。 */
describe('agent_sessions', () => {
  const row: AgentSessionRow = {
    id: newId(AgentSessionId),
    projectId: newId(ProjectId),
    title: 'テロップを直す',
    model: 'claude-sonnet-5-5',
    cliSessionId: '6a4a65e2-1d81-49ef-add0-13d11b944480',
    status: 'idle',
    confirmationsWaived: false,
    costUsd: 0.12,
    editCount: 3,
    lastSummary: '0:03 の文言を変えました',
    createdAt: new Date('2026-10-23T00:00:00Z'),
    lastActiveAt: new Date('2026-10-23T01:00:00Z'),
  }

  it('行を会話にする', () => {
    expect(agentSessionRowToDomain(row)).toEqual(row)
  })

  it('知らない状態・別名のモデル・空の題名の行は失敗する', () => {
    expect(() => agentSessionRowToDomain({ ...row, status: 'paused' as AgentSessionRow['status'] })).toThrow()
    expect(() => agentSessionRowToDomain({ ...row, model: 'sonnet' })).toThrow()
    expect(() => agentSessionRowToDomain({ ...row, title: '' })).toThrow()
  })

  it('同じ作品で作業中（確認待ちを含む）の会話は 1 つだけ', () => {
    const index = getTableConfig(agentSessions).indexes.find((i) => i.config.name === 'agent_sessions_project_busy_uidx')
    expect(index?.config.unique).toBe(true)
    expect(index?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual(['project_id'])
    expect(index?.config.where).toBeDefined()
  })

  it('作品を消せば会話も消える', () => {
    const { foreignKeys } = getTableConfig(agentSessions)
    expect(foreignKeys.map((fk) => [fk.reference().columns.map((c) => c.name).join(), fk.onDelete])).toEqual([
      ['project_id', 'cascade'],
    ])
  })
})

describe('agent_messages', () => {
  const row: AgentMessageRow = {
    sessionId: newId(AgentSessionId),
    seq: 1,
    body: { kind: 'assistant_text', text: 'はい' },
    createdAt: new Date('2026-10-23T00:00:00Z'),
  }

  it('行を会話の行にする', () => {
    expect(agentMessageRowToDomain(row)).toEqual(row)
  })

  it('通し番号は 1 から。知らない種類の中身は失敗する', () => {
    expect(() => agentMessageRowToDomain({ ...row, seq: 0 })).toThrow()
    expect(() => agentMessageRowToDomain({ ...row, body: { kind: 'shell' } as unknown as AgentMessageRow['body'] })).toThrow()
  })

  it('会話と通し番号の組で一意（主キー）', () => {
    const [pk] = getTableConfig(agentMessages).primaryKeys
    expect(pk?.columns.map((c) => c.name)).toEqual(['session_id', 'seq'])
  })
})
