import {
  AgentMessageBody,
  AgentSessionStatus,
  type AgentApprovalAnswer,
  type ProjectId,
  type SendAgentMessageInput,
  type UpdateAgentSessionInput,
} from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * AI エージェントのタブ（ADR-0058）の口。返事は流れの口（`use-agent-stream.ts`）で受ける。
 *
 *   POST  /projects/{P}/agent-sessions · GET /projects/{P}/agent-sessions
 *   GET   /agent-sessions/{id} · PATCH /agent-sessions/{id}
 *   POST  /agent-sessions/{id}/messages · POST /agent-sessions/{id}/stop
 *   POST  /agent-sessions/{id}/approvals/{requestId}
 */

export const WireAgentSession = z.object({
  id: z.string(),
  title: z.string(),
  model: z.string(),
  status: AgentSessionStatus,
  confirmationsWaived: z.boolean(),
  costUsd: z.number(),
  editCount: z.number(),
  lastSummary: z.string().nullable(),
  createdAt: z.string(),
  lastActiveAt: z.string(),
})
export type WireAgentSession = z.infer<typeof WireAgentSession>

export const WireAgentMessage = z.object({ seq: z.number().int().min(1), body: AgentMessageBody, createdAt: z.string() })
export type WireAgentMessage = z.infer<typeof WireAgentMessage>

export type AgentApi = {
  readonly list: (projectId: ProjectId) => Promise<readonly WireAgentSession[]>
  readonly create: (projectId: ProjectId, model: string) => Promise<WireAgentSession>
  readonly update: (sessionId: string, patch: UpdateAgentSessionInput) => Promise<WireAgentSession>
  readonly send: (sessionId: string, input: SendAgentMessageInput) => Promise<WireAgentSession>
  readonly stop: (sessionId: string) => Promise<void>
  readonly answer: (sessionId: string, requestId: string, answer: AgentApprovalAnswer) => Promise<void>
}

const seg = (value: string): string => encodeURIComponent(value)

export const createAgentApi = (requester: Requester): AgentApi => ({
  list: (projectId) => requester.get(`/projects/${seg(projectId)}/agent-sessions`, z.array(WireAgentSession)),
  create: (projectId, model) => requester.post(`/projects/${seg(projectId)}/agent-sessions`, { model }, WireAgentSession),
  update: (sessionId, patch) => requester.patch(`/agent-sessions/${seg(sessionId)}`, patch, WireAgentSession),
  send: (sessionId, input) => requester.post(`/agent-sessions/${seg(sessionId)}/messages`, input, WireAgentSession),
  stop: async (sessionId) => {
    await requester.post(`/agent-sessions/${seg(sessionId)}/stop`, undefined, z.null())
  },
  answer: async (sessionId, requestId, answer) => {
    await requester.post(`/agent-sessions/${seg(sessionId)}/approvals/${seg(requestId)}`, answer, z.null())
  },
})

/** 流れの口の URL。`after` の続きから受ける（繋ぎ直したときに取りこぼしを埋める）。 */
export const agentStreamUrl = (baseUrl: string, sessionId: string, afterSeq: number): string =>
  `${baseUrl.replace(/\/+$/, '')}/agent-sessions/${seg(sessionId)}/stream?after=${String(Math.max(0, Math.floor(afterSeq)))}`

/** 選べるモデル。**既定は Sonnet**（API の `AGENT_MODEL_DEFAULT` と同じ）。画面には名前だけ出す。 */
export const AGENT_MODEL_CHOICES = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet（既定）' },
  { id: 'claude-opus-5-5', label: 'Opus' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku' },
] as const
export const DEFAULT_AGENT_MODEL = AGENT_MODEL_CHOICES[0].id

export const agentModelLabel = (model: string): string =>
  AGENT_MODEL_CHOICES.find((choice) => choice.id === model)?.label ?? model
