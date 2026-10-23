import { OpenAPIHono } from '@hono/zod-openapi'
import { AgentSessionId, newId, ProjectId, type AgentSession } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { createAgentHub } from '../agent/agent-hub.js'
import { createLogger } from '../logger.js'
import { agentStreamRoutes } from '../routes/agent-stream.js'
import { createInMemoryAgentSessions } from './in-memory-agent-sessions.js'

/**
 * 会話の流れ（SSE。ADR-0058）。通し番号の続きから配り、取りこぼしを埋め、同じ行を 2 度送らない。
 */

const READ_TIMEOUT_MS = 2000

const aSession = (): AgentSession => ({
  id: newId(AgentSessionId),
  projectId: newId(ProjectId),
  title: 'テロップを直す',
  model: 'claude-sonnet-5-5',
  cliSessionId: 'secret-cli-session',
  status: 'running',
  confirmationsWaived: false,
  costUsd: 0,
  editCount: 0,
  lastSummary: null,
  createdAt: new Date(),
  lastActiveAt: new Date(),
})

const setup = async () => {
  const sessions = createInMemoryAgentSessions()
  const session = aSession()
  sessions.seed(session)
  await sessions.appendMessages(session.id, [
    { kind: 'user', text: '1', context: null },
    { kind: 'assistant_text', text: '2' },
    { kind: 'assistant_text', text: '3' },
  ])
  const hub = createAgentHub(() => undefined)
  const app = new OpenAPIHono()
  app.route('/', agentStreamRoutes({ sessions, hub, logger: createLogger('silent'), heartbeatIntervalMs: 20 }))
  return { app, hub, session, sessions }
}

/** 本文を、条件を満たすまで読む。 */
const readUntil = async (res: Response, done: (text: string) => boolean): Promise<string> => {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = res.body?.getReader()
  if (reader === undefined) throw new Error('本文がありません')
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + READ_TIMEOUT_MS
  while (!done(text)) {
    if (Date.now() > deadline) throw new Error(`待ちきれませんでした:\n${text}`)
    const chunk = await reader.read()
    if (chunk.done) break
    text += decoder.decode(chunk.value)
  }
  await reader.cancel()
  return text
}

const ids = (text: string): number[] => [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]))

describe('GET /agent-sessions/{id}/stream', () => {
  it('接続直後に会話の状態を送り、通し番号の続き（Last-Event-ID の後）を送る', async () => {
    const t = await setup()
    const res = await t.app.request(`/agent-sessions/${t.session.id}/stream`, { headers: { 'Last-Event-ID': '1' } })
    expect(res.status).toBe(200)
    const text = await readUntil(res, (s) => ids(s).length >= 2)
    expect(text.indexOf('event: session')).toBeLessThan(text.indexOf('event: message'))
    expect(ids(text)).toEqual([2, 3])
    expect(text).not.toContain('secret-cli-session')
  })

  it('?after= でも続きから。あとから足した行と「直した」も流す。同じ番号は 2 度送らない', async () => {
    const t = await setup()
    const res = await t.app.request(`/agent-sessions/${t.session.id}/stream?after=3`)
    const reading = readUntil(res, (s) => ids(s).includes(4) && s.includes('event: edited'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    const [added] = await t.sessions.appendMessages(t.session.id, [{ kind: 'assistant_text', text: '4' }])
    if (added !== undefined) {
      t.hub.publish(t.session.id, { type: 'message', message: added })
      t.hub.publish(t.session.id, { type: 'message', message: added })
    }
    t.hub.publish(t.session.id, { type: 'edited' })
    const text = await reading
    expect(ids(text)).toEqual([4])
  })

  it('心拍を送る', async () => {
    const t = await setup()
    const res = await t.app.request(`/agent-sessions/${t.session.id}/stream?after=3`)
    expect(await readUntil(res, (s) => s.includes(': heartbeat'))).toContain(': heartbeat')
  })

  it('無い会話は 404', async () => {
    const t = await setup()
    expect((await t.app.request(`/agent-sessions/${newId(AgentSessionId)}/stream`)).status).toBe(404)
  })
})
