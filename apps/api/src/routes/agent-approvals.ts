import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { AgentApprovalAnswer, AgentApprovalDecision, AgentSessionId as AgentSessionIdSchema, ToolRisk } from '@ixa/domain'
import type { AgentService } from '../agent/agent-service.js'
import { presentedToken } from '../auth/gate.js'
import { validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { AGENT_FAILURE_STATUS } from './agent-sessions.js'
import { json } from './agent-wire.js'

/**
 * AI エージェントの確認（ADR-0058）。
 *
 *   POST /agent-sessions/{id}/approvals              MCP の approve が頼む（そのやりとりの鍵だけ）
 *   GET  /agent-sessions/{id}/approvals/{requestId}  MCP の approve が答えを待つ（同上）
 *   POST /agent-sessions/{id}/approvals/{requestId}  画面の確認のカードが答える（**画面（クッキー）からだけ**）
 *
 * 答えを画面からだけにするのは、エージェント自身（Bearer の鍵）が自分の確認に答えられないようにするため。
 */

export const ANSWER_NEEDS_BROWSER_MESSAGE = '確認には画面から答えてください'

const SessionParams = z.object({ sessionId: AgentSessionIdSchema.openapi({ param: { name: 'sessionId', in: 'path' } }) })
const RequestParams = SessionParams.extend({
  requestId: z.string().ulid().openapi({ param: { name: 'requestId', in: 'path' } }),
})

const ApprovalRequestBody = z
  .object({
    toolName: z.string().min(1).max(200),
    toolUseId: z.string().min(1).max(200).nullable(),
    risk: ToolRisk,
    input: z.unknown(),
  })
  .strict()
  .openapi('AgentApprovalRequest')

const ApprovalStateResponse = z
  .object({ requestId: z.string(), decision: AgentApprovalDecision.nullable(), message: z.string().nullable() })
  .openapi('AgentApprovalState')

const errors = {
  403: errorContent('このやりとりの鍵ではない・画面からでない'),
  404: errorContent('会話・確認が無い'),
  409: errorContent('もう答えた'),
  422: errorContent('入力の誤り'),
}

const requestRoute = createRoute({
  method: 'post',
  path: '/agent-sessions/{sessionId}/approvals',
  tags: ['agent'],
  summary: '実行してよいかを聞く（MCP の approve から）',
  request: { params: SessionParams, body: { required: true, content: { 'application/json': { schema: ApprovalRequestBody } } } },
  responses: { 200: json('確認の状態（要らなければすぐ allow）', successResponse(ApprovalStateResponse)), ...errors },
})
const stateRoute = createRoute({
  method: 'get',
  path: '/agent-sessions/{sessionId}/approvals/{requestId}',
  tags: ['agent'],
  summary: '確認の答え（まだなら decision は null）',
  request: { params: RequestParams },
  responses: { 200: json('確認の状態', successResponse(ApprovalStateResponse)), ...errors },
})
const answerRoute = createRoute({
  method: 'post',
  path: '/agent-sessions/{sessionId}/approvals/{requestId}',
  tags: ['agent'],
  summary: '確認に答える（実行／やめる／以後このタスクでは確認しない）',
  request: { params: RequestParams, body: { required: true, content: { 'application/json': { schema: AgentApprovalAnswer } } } },
  responses: { 200: json('答えた', successResponse(z.null())), ...errors },
})

const bearerOf = (c: Parameters<typeof presentedToken>[0]): string | null => {
  const presented = presentedToken(c)
  return presented?.via === 'bearer' ? presented.token : null
}

export const agentApprovalRoutes = (deps: { readonly agent: AgentService }) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(requestRoute, async (c) => {
      const body = c.req.valid('json')
      const result = await deps.agent.requestApproval(c.req.valid('param').sessionId, bearerOf(c), {
        toolName: body.toolName,
        toolUseId: body.toolUseId,
        risk: body.risk,
        input: body.input,
      })
      if (!result.ok) return c.json(fail(result.message), AGENT_FAILURE_STATUS[result.code])
      return c.json(ok(result.value), 200)
    })
    .openapi(stateRoute, async (c) => {
      const { sessionId, requestId } = c.req.valid('param')
      const result = await deps.agent.approvalState(sessionId, bearerOf(c), requestId)
      if (!result.ok) return c.json(fail(result.message), AGENT_FAILURE_STATUS[result.code])
      return c.json(ok(result.value), 200)
    })
    .openapi(answerRoute, async (c) => {
      if (presentedToken(c)?.via !== 'cookie') return c.json(fail(ANSWER_NEEDS_BROWSER_MESSAGE), 403)
      const { sessionId, requestId } = c.req.valid('param')
      const result = await deps.agent.answerApproval(sessionId, requestId, c.req.valid('json'))
      if (!result.ok) return c.json(fail(result.message), AGENT_FAILURE_STATUS[result.code])
      return c.json(ok(null), 200)
    })
