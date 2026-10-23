import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  AgentSessionId as AgentSessionIdSchema,
  CreateAgentSessionInput,
  ProjectId as ProjectIdSchema,
  SendAgentMessageInput,
  UpdateAgentSessionInput,
  sortAgentSessionsForList,
} from '@ixa/domain'
import type { AgentSessionRepository } from '@ixa/db'
import type { AgentFailure, AgentService } from '../agent/agent-service.js'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { presentedToken } from '../auth/gate.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { AgentSessionResponse, json, toAgentSessionResponse } from './agent-wire.js'

/**
 * AI エージェントの会話（ADR-0058。制作者の要望 2026-10-23）。画面の「AI エージェント」のタブが使う。
 *
 *   POST  /projects/{P}/agent-sessions      新しいタスク
 *   GET   /projects/{P}/agent-sessions      一覧（確認待ち・作業中が上、残りは新しい順）
 *   GET   /agent-sessions/{id}
 *   PATCH /agent-sessions/{id}              題名・モデル・確認なしの旗
 *   POST  /agent-sessions/{id}/messages     話す（1 回のやりとりを始める。返事は流れの口で受ける）
 *   POST  /agent-sessions/{id}/stop
 */

const ProjectParams = z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) })
const SessionParams = z.object({ sessionId: AgentSessionIdSchema.openapi({ param: { name: 'sessionId', in: 'path' } }) })
const body = <T extends z.ZodTypeAny>(schema: T) => ({ required: true, content: { 'application/json': { schema } } })

const errors = {
  403: errorContent('このやりとりの鍵ではない'),
  404: errorContent('作品・会話が無い'),
  409: errorContent('別のタスクが作業中・このタスクが作業中'),
  422: errorContent('入力の誤り・テキストの AI が Claude でない'),
}

const createSessionRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/agent-sessions',
  tags: ['agent'],
  summary: '新しいタスク（会話）を作る',
  request: { params: ProjectParams, body: body(CreateAgentSessionInput) },
  responses: { 201: json('作った', successResponse(AgentSessionResponse)), ...errors },
})
const listRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/agent-sessions',
  tags: ['agent'],
  summary: '作品の会話の一覧',
  request: { params: ProjectParams },
  responses: { 200: json('会話', successResponse(z.array(AgentSessionResponse))), 404: errors[404] },
})
const getRoute = createRoute({
  method: 'get',
  path: '/agent-sessions/{sessionId}',
  tags: ['agent'],
  summary: '会話 1 件',
  request: { params: SessionParams },
  responses: { 200: json('会話', successResponse(AgentSessionResponse)), 404: errors[404] },
})
const updateRoute = createRoute({
  method: 'patch',
  path: '/agent-sessions/{sessionId}',
  tags: ['agent'],
  summary: '題名・モデル・確認なしの旗を直す',
  request: { params: SessionParams, body: body(UpdateAgentSessionInput) },
  responses: { 200: json('直した', successResponse(AgentSessionResponse)), ...errors },
})
const sendRoute = createRoute({
  method: 'post',
  path: '/agent-sessions/{sessionId}/messages',
  tags: ['agent'],
  summary: '話す（1 回のやりとりを始める）',
  request: { params: SessionParams, body: body(SendAgentMessageInput) },
  responses: { 202: json('始めた', successResponse(AgentSessionResponse)), ...errors },
})
const stopRoute = createRoute({
  method: 'post',
  path: '/agent-sessions/{sessionId}/stop',
  tags: ['agent'],
  summary: '作業中のやりとりを止める',
  request: { params: SessionParams },
  responses: { 202: json('止めた', successResponse(z.null())), ...errors },
})

export type AgentSessionRoutesDeps = {
  readonly agent: AgentService
  readonly sessions: Pick<AgentSessionRepository, 'findById' | 'findByProject'>
  readonly projects: { readonly findById: (id: z.infer<typeof ProjectIdSchema>) => Promise<unknown> }
}

export const WAIVE_NEEDS_BROWSER_MESSAGE = '確認なしへの切り替えは画面からだけできます'

/** 失敗の種類 → 状態コード。 */
export const AGENT_FAILURE_STATUS = { not_found: 404, conflict: 409, unavailable: 422, forbidden: 403 } as const satisfies Record<
  AgentFailure['code'],
  number
>

export const agentSessionRoutes = (deps: AgentSessionRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(createSessionRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const result = await deps.agent.create(projectId, c.req.valid('json').model)
      if (!result.ok) return c.json(fail(result.message), 404)
      return c.json(ok(toAgentSessionResponse(result.value)), 201)
    })
    .openapi(listRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const sessions = sortAgentSessionsForList(await deps.sessions.findByProject(projectId))
      return c.json(ok(sessions.map(toAgentSessionResponse)), 200)
    })
    .openapi(getRoute, async (c) => {
      const session = await deps.sessions.findById(c.req.valid('param').sessionId)
      if (session === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(toAgentSessionResponse(session)), 200)
    })
    .openapi(updateRoute, async (c) => {
      // 確認なしへの切り替えは画面（クッキー）からだけ。エージェント（Bearer）が自分で旗を立てられないように。
      if (c.req.valid('json').confirmationsWaived === true && presentedToken(c)?.via !== 'cookie') {
        return c.json(fail(WAIVE_NEEDS_BROWSER_MESSAGE), 403)
      }
      const result = await deps.agent.update(c.req.valid('param').sessionId, c.req.valid('json'))
      if (!result.ok) return c.json(fail(result.message), AGENT_FAILURE_STATUS[result.code])
      return c.json(ok(toAgentSessionResponse(result.value)), 200)
    })
    .openapi(sendRoute, async (c) => {
      const result = await deps.agent.send(c.req.valid('param').sessionId, c.req.valid('json'))
      if (!result.ok) return c.json(fail(result.message), AGENT_FAILURE_STATUS[result.code])
      return c.json(ok(toAgentSessionResponse(result.value)), 202)
    })
    .openapi(stopRoute, async (c) => {
      const result = await deps.agent.stop(c.req.valid('param').sessionId)
      if (!result.ok) return c.json(fail(result.message), AGENT_FAILURE_STATUS[result.code])
      return c.json(ok(null), 202)
    })
