import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { AgentSessionRepository } from '@ixa/db'
import { AgentSessionId as AgentSessionIdSchema, type AgentMessage } from '@ixa/domain'
import { streamSSE } from 'hono/streaming'
import type { AgentHub, AgentStreamEvent } from '../agent/agent-hub.js'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import type { Logger } from '../logger.js'
import { errorContent, fail } from '../response.js'
import { toAgentMessageResponse, toAgentSessionResponse } from './agent-wire.js'
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_LINE } from './events.js'

/**
 * 会話の流れ（SSE。ADR-0058）。**通し番号の続きから配る。** 取りこぼしは `Last-Event-ID`（または `?after=`）で埋める。
 *
 * - `event: message` / `id: <seq>` / `data: {seq, body, createdAt}` — 会話の行
 * - `event: session` / `data: <会話>` — 状態・確認なしの旗が変わった（接続直後にも 1 回。これが「繋がった」の印）
 * - `event: edited` — 作品を書き換えた（画面はタイムラインを読み直す）
 * - `: heartbeat` — 心拍
 *
 * 取りこぼさない順: 先に受け取りを始めて溜め、DB の続きを送り、溜めた行のうちまだ送っていない番号だけを送る。
 */

const SessionParams = z.object({ sessionId: AgentSessionIdSchema.openapi({ param: { name: 'sessionId', in: 'path' } }) })
const StreamQuery = z.object({
  after: z.coerce.number().int().min(0).optional().openapi({ param: { name: 'after', in: 'query' } }),
})

const streamRoute = createRoute({
  method: 'get',
  path: '/agent-sessions/{sessionId}/stream',
  tags: ['agent'],
  summary: '会話の流れ（SSE。通し番号の続きから）',
  request: { params: SessionParams, query: StreamQuery },
  responses: { 200: { description: '会話の流れ（text/event-stream）' }, 404: errorContent('会話が無い') },
})

export type AgentStreamRoutesDeps = {
  readonly sessions: Pick<AgentSessionRepository, 'findById' | 'listMessages'>
  readonly hub: AgentHub
  readonly logger: Logger
  /** 心拍の間隔。テストから縮める。 */
  readonly heartbeatIntervalMs?: number
}

const lastEventIdOf = (header: string | undefined): number | null => {
  if (header === undefined) return null
  const value = Number(header)
  return Number.isInteger(value) && value >= 0 ? value : null
}

export const agentStreamRoutes = (deps: AgentStreamRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(streamRoute, async (c) => {
    const { sessionId } = c.req.valid('param')
    const session = await deps.sessions.findById(sessionId)
    if (session === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const after = lastEventIdOf(c.req.header('Last-Event-ID')) ?? c.req.valid('query').after ?? 0

    return streamSSE(c, async (stream) => {
      const state = { sent: after, live: false, closed: false }
      let buffered: readonly AgentStreamEvent[] = []
      let writes: Promise<void> = Promise.resolve()

      const writeMessage = async (message: AgentMessage): Promise<void> => {
        if (message.seq <= state.sent) return
        state.sent = message.seq
        await stream.writeSSE({ event: 'message', id: String(message.seq), data: JSON.stringify(toAgentMessageResponse(message)) })
      }
      const write = async (event: AgentStreamEvent): Promise<void> => {
        if (event.type === 'message') {
          // 後の番号が先に届いたら、飛んだ番号を DB から埋めてから送る（前の行を捨てない）。
          if (event.message.seq > state.sent + 1) {
            const gap = await deps.sessions.listMessages(sessionId, state.sent)
            for (const message of gap.filter((m) => m.seq < event.message.seq)) await writeMessage(message)
          }
          await writeMessage(event.message)
          return
        }
        if (event.type === 'session') {
          await stream.writeSSE({ event: 'session', data: JSON.stringify(toAgentSessionResponse(event.session)) })
          return
        }
        await stream.writeSSE({ event: 'edited', data: '{}' })
      }
      const enqueue = (event: AgentStreamEvent): void => {
        writes = writes
          .then(async () => {
            if (state.closed || stream.aborted || stream.closed) return
            await write(event)
          })
          .catch((error: unknown) => {
            deps.logger.warn({ err: error, agentSessionId: sessionId }, '会話の流れを書き出せませんでした')
            state.closed = true
          })
      }

      const unsubscribe = deps.hub.subscribe(sessionId, (event) => {
        if (state.live) enqueue(event)
        else buffered = [...buffered, event]
      })
      const wake: { fn: (() => void) | null } = { fn: null }
      const close = (): void => {
        state.closed = true
        wake.fn?.()
      }
      stream.onAbort(close)
      c.req.raw.signal.addEventListener('abort', close)

      try {
        const backlog = await deps.sessions.listMessages(sessionId, after)
        const current = (await deps.sessions.findById(sessionId)) ?? session
        enqueue({ type: 'session', session: current })
        backlog.forEach((message) => enqueue({ type: 'message', message }))
        buffered.forEach(enqueue)
        buffered = []
        state.live = true

        const heartbeatMs = deps.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
        while (!state.closed && !stream.aborted && !stream.closed) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, heartbeatMs)
            wake.fn = () => {
              clearTimeout(timer)
              resolve()
            }
          })
          if (state.closed || stream.aborted || stream.closed) break
          writes = writes.then(() => stream.write(HEARTBEAT_LINE).then(() => undefined)).catch(() => {
            state.closed = true
          })
        }
      } catch (error) {
        deps.logger.error({ err: error, agentSessionId: sessionId }, '会話の流れを始められませんでした')
      } finally {
        unsubscribe()
        await writes
      }
    })
  })
