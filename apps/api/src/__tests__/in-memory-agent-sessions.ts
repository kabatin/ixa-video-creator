import { AgentSessionBusyError, DbNotFoundError, type AgentSessionRepository } from '@ixa/db'
import {
  AgentMessageBody,
  AgentSessionId,
  canTransitionAgentSession,
  isAgentSessionBusy,
  newId,
  type AgentMessage,
  type AgentSession,
} from '@ixa/domain'

/**
 * 会話の表のテストダブル。本物と同じく、決めていない遷移は null、同じ作品で 2 つ目を作業中にすると
 * `AgentSessionBusyError`（部分一意索引の代わり）。通し番号は会話ごとに 1 から。
 */
export type InMemoryAgentSessions = AgentSessionRepository & {
  readonly all: () => readonly AgentSession[]
  readonly messages: (id: AgentSession['id']) => readonly AgentMessage[]
  readonly seed: (session: AgentSession) => void
}

export const createInMemoryAgentSessions = (): InMemoryAgentSessions => {
  let sessions: readonly AgentSession[] = []
  let messages: readonly AgentMessage[] = []
  const find = (id: AgentSession['id']): AgentSession => {
    const found = sessions.find((s) => s.id === id)
    if (found === undefined) throw new DbNotFoundError('agent_sessions', id)
    return found
  }
  const put = (next: AgentSession): AgentSession => {
    sessions = sessions.map((s) => (s.id === next.id ? next : s))
    return next
  }
  return {
    all: () => sessions,
    messages: (id) => messages.filter((m) => m.sessionId === id),
    seed: (session) => {
      sessions = [...sessions, session]
    },
    create: (input) => {
      const at = new Date()
      const session: AgentSession = {
        id: newId(AgentSessionId),
        projectId: input.projectId,
        title: input.title,
        model: input.model,
        cliSessionId: null,
        status: 'idle',
        confirmationsWaived: false,
        costUsd: 0,
        editCount: 0,
        lastSummary: null,
        createdAt: at,
        lastActiveAt: at,
      }
      sessions = [...sessions, session]
      return Promise.resolve(session)
    },
    findById: (id) => Promise.resolve(sessions.find((s) => s.id === id) ?? null),
    findByProject: (projectId) =>
      Promise.resolve(
        [...sessions.filter((s) => s.projectId === projectId)].sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime()),
      ),
    findBusyInProject: (projectId) =>
      Promise.resolve(sessions.find((s) => s.projectId === projectId && isAgentSessionBusy(s.status)) ?? null),
    update: (id, patch) => {
      const current = find(id)
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      return Promise.resolve(put({ ...current, ...defined }))
    },
    transition: (id, to, at) => {
      const current = find(id)
      if (!canTransitionAgentSession(current.status, to)) return Promise.resolve(null)
      const other = sessions.find((s) => s.projectId === current.projectId && s.id !== id && isAgentSessionBusy(s.status))
      if (isAgentSessionBusy(to) && other !== undefined) return Promise.reject(new AgentSessionBusyError(current.projectId))
      return Promise.resolve(put({ ...current, status: to, lastActiveAt: at }))
    },
    setCliSessionId: (id, cliSessionId) => {
      put({ ...find(id), cliSessionId })
      return Promise.resolve()
    },
    recordTurn: (id, turn) => {
      const current = find(id)
      return Promise.resolve(
        put({
          ...current,
          costUsd: current.costUsd + turn.addCostUsd,
          editCount: current.editCount + turn.addEditCount,
          lastActiveAt: turn.at,
          lastSummary: turn.lastSummary ?? current.lastSummary,
        }),
      )
    },
    interruptAllBusy: (at) => {
      const busy = sessions.filter((s) => isAgentSessionBusy(s.status))
      return Promise.resolve(busy.map((s) => put({ ...s, status: 'interrupted', lastActiveAt: at })))
    },
    appendMessages: (sessionId, bodies) => {
      find(sessionId)
      const start = messages.filter((m) => m.sessionId === sessionId).length + 1
      const added = bodies.map((body, i) => ({
        sessionId,
        seq: start + i,
        body: AgentMessageBody.parse(body),
        createdAt: new Date(),
      }))
      messages = [...messages, ...added]
      return Promise.resolve(added)
    },
    listMessages: (sessionId, afterSeq) =>
      Promise.resolve(messages.filter((m) => m.sessionId === sessionId && m.seq > afterSeq)),
  }
}
