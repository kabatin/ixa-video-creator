import { z } from '@hono/zod-openapi'
import { AgentSessionStatus, type AgentMessage, type AgentSession } from '@ixa/domain'

/**
 * AI エージェントの会話の応答の形（ADR-0058）。会話の口・確認の口・流れの口が同じ形を返す。
 * **CLI の会話 ID は出さない**（API の中だけで使う）。
 */

export const AgentSessionResponse = z
  .object({
    id: z.string(),
    title: z.string(),
    model: z.string(),
    status: AgentSessionStatus,
    confirmationsWaived: z.boolean(),
    costUsd: z.number(),
    editCount: z.number().int(),
    lastSummary: z.string().nullable(),
    createdAt: z.string().datetime(),
    lastActiveAt: z.string().datetime(),
  })
  .openapi('AgentSession')

export const toAgentSessionResponse = (session: AgentSession): z.infer<typeof AgentSessionResponse> => ({
  id: session.id,
  title: session.title,
  model: session.model,
  status: session.status,
  confirmationsWaived: session.confirmationsWaived,
  costUsd: session.costUsd,
  editCount: session.editCount,
  lastSummary: session.lastSummary,
  createdAt: session.createdAt.toISOString(),
  lastActiveAt: session.lastActiveAt.toISOString(),
})

/** 会話の行。中身は domain の `AgentMessageBody`（種類ごとに形が決まる）。 */
export const toAgentMessageResponse = (message: AgentMessage) => ({
  seq: message.seq,
  body: message.body,
  createdAt: message.createdAt.toISOString(),
})

export const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})
