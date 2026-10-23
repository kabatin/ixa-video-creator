import { z } from 'zod'
import { AgentSessionId } from '../common/ids.js'
import { ToolRisk } from './tool-risk.js'

/**
 * 会話の 1 行（ADR-0058）。会話ごとに通し番号（`seq`）で並ぶ。中身は種類ごとに形が決まる。
 *
 * CLI の流れ（stream-json）から来るもの: `assistant_text` / `tool_call` / `tool_result` / `turn_end` / `system`。
 * ixa が足すもの: `user`（制作者の発言）/ `approval_request` / `approval_decision` / `system`（旗の切り替え・中断）。
 * 時間は秒（規約 3）。
 */

/** 送るときに添えた文脈（画面で選んでいたもの）。会話に残し、何を見て頼んだかを後から分かるようにする。 */
export const AgentMessageContext = z.object({
  shotLabel: z.string().max(80).nullable(),
  playheadSec: z.number().min(0).nullable(),
})
export type AgentMessageContext = z.infer<typeof AgentMessageContext>

/**
 * `system` の出来事。
 * - `cli_init`: CLI が会話を始めた（`text` はモデル）
 * - `confirmations_waived` / `confirmations_restored`: 確認なしの旗を立てた・戻した
 * - `interrupted`: 止めた・API が落ちて途切れた
 * - `failed`: CLI が起こせなかった・異常に終わった（`text` は理由）
 * - `unknown_line` / `unparsable`: 知らない行・読めない行（捨てずに残す）
 */
export const AgentSystemEvent = z.enum([
  'cli_init',
  'confirmations_waived',
  'confirmations_restored',
  'interrupted',
  'failed',
  'unknown_line',
  'unparsable',
])
export type AgentSystemEvent = z.infer<typeof AgentSystemEvent>

export const AgentApprovalDecision = z.enum(['allow', 'deny'])
export type AgentApprovalDecision = z.infer<typeof AgentApprovalDecision>

export const AgentMessageBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), text: z.string().min(1), context: AgentMessageContext.nullable() }),
  z.object({ kind: z.literal('assistant_text'), text: z.string() }),
  z.object({ kind: z.literal('tool_call'), toolUseId: z.string(), toolName: z.string(), input: z.unknown() }),
  z.object({ kind: z.literal('tool_result'), toolUseId: z.string(), isError: z.boolean(), text: z.string() }),
  z.object({
    kind: z.literal('approval_request'),
    requestId: z.string().ulid(),
    toolUseId: z.string().nullable(),
    toolName: z.string(),
    risk: ToolRisk,
    input: z.unknown(),
  }),
  z.object({
    kind: z.literal('approval_decision'),
    requestId: z.string().ulid(),
    decision: AgentApprovalDecision,
    waiveAfter: z.boolean(),
  }),
  z.object({ kind: z.literal('system'), event: AgentSystemEvent, text: z.string().nullable(), raw: z.unknown() }),
  z.object({
    kind: z.literal('turn_end'),
    isError: z.boolean(),
    text: z.string().nullable(),
    costUsd: z.number().min(0),
    durationSec: z.number().min(0),
  }),
])
export type AgentMessageBody = z.infer<typeof AgentMessageBody>
export type AgentMessageKind = AgentMessageBody['kind']

export const AgentMessage = z.object({
  sessionId: AgentSessionId,
  seq: z.number().int().min(1),
  body: AgentMessageBody,
  createdAt: z.date(),
})
export type AgentMessage = z.infer<typeof AgentMessage>
