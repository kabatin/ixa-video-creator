import { z } from 'zod'
import type { AgentMessageBody } from './agent-message.js'

/**
 * Claude CLI の `-p --output-format stream-json --verbose` の 1 行を、会話の行に変える（ADR-0058）。
 *
 * 形は CLI 2.1.289 を実際に流して確かめた（fixture: `__tests__/fixtures/claude-stream-json/`）。
 * - `{type:"system",subtype:"init",session_id,model}` … 会話の始まり
 * - `{type:"assistant",message:{content:[{type:"text"}|{type:"tool_use",id,name,input}]}}`
 * - `{type:"user",message:{content:[{type:"tool_result",tool_use_id,content,is_error?}]}}`
 * - `{type:"result",subtype,is_error,result,total_cost_usd,duration_ms,session_id}` … やりとりの終わり
 *   （`subtype` が `success` でも `is_error` が true のことがある。モデル名の誤りなど）
 *
 * **知らない行・知らない部分は捨てずに `system` として残す**（CLI の版が上がって形が増えても、記録は欠けない）。
 */

export type StreamJsonLineResult = {
  readonly bodies: readonly AgentMessageBody[]
  /** この行が持っていた CLI の会話 ID（`--resume` に渡す）。無ければ null。 */
  readonly cliSessionId: string | null
}

/** 結果の文字の上限。ツールの結果は長いことがあり、会話の行を太らせない。 */
export const TOOL_RESULT_TEXT_MAX = 2000

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text)

/** 会話の行に残す JSON の上限（字数）。ツールの結果と同じ。 */
export const STORED_JSON_MAX = TOOL_RESULT_TEXT_MAX

/**
 * 長い中身（知らない行・ツールの入力）を、JSON の長さで切る。超えたら `{ truncated: true, preview }` にする
 * （会話の行を太らせない。何が来たかは先頭で分かる）。
 */
export const capJson = (value: unknown, max: number = STORED_JSON_MAX): unknown => {
  const json = JSON.stringify(value) ?? ''
  return json.length <= max ? value : { truncated: true, preview: json.slice(0, max) }
}

const Envelope = z.object({ type: z.string(), session_id: z.string().optional() }).passthrough()

const InitLine = z.object({ type: z.literal('system'), subtype: z.literal('init'), model: z.string().optional() })

const TextBlock = z.object({ type: z.literal('text'), text: z.string() })
const ToolUseBlock = z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() })
const ToolResultBlock = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())]),
  is_error: z.boolean().optional(),
})

const MessageLine = z.object({
  type: z.enum(['assistant', 'user']),
  message: z.object({ content: z.union([z.string(), z.array(z.unknown())]) }),
})

const ResultLine = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  total_cost_usd: z.number().min(0).optional(),
  duration_ms: z.number().min(0).optional(),
})

const unknownBody = (raw: unknown): AgentMessageBody => ({ kind: 'system', event: 'unknown_line', text: null, raw: capJson(raw) })

const toolResultText = (content: z.infer<typeof ToolResultBlock>['content']): string =>
  typeof content === 'string' ? content : content.map((part) => part.text ?? `[${part.type}]`).join('\n')

const blockBody = (block: unknown): AgentMessageBody => {
  const text = TextBlock.safeParse(block)
  if (text.success) return { kind: 'assistant_text', text: text.data.text }
  const toolUse = ToolUseBlock.safeParse(block)
  if (toolUse.success) {
    return { kind: 'tool_call', toolUseId: toolUse.data.id, toolName: toolUse.data.name, input: capJson(toolUse.data.input ?? {}) }
  }
  const result = ToolResultBlock.safeParse(block)
  if (result.success) {
    return {
      kind: 'tool_result',
      toolUseId: result.data.tool_use_id,
      isError: result.data.is_error ?? false,
      text: truncate(toolResultText(result.data.content), TOOL_RESULT_TEXT_MAX),
    }
  }
  return unknownBody(block)
}

const bodiesOf = (raw: unknown): readonly AgentMessageBody[] => {
  const init = InitLine.safeParse(raw)
  if (init.success) return [{ kind: 'system', event: 'cli_init', text: init.data.model ?? null, raw: null }]
  const result = ResultLine.safeParse(raw)
  if (result.success) {
    const r = result.data
    return [
      {
        kind: 'turn_end',
        isError: r.is_error === true || r.subtype !== 'success',
        text: r.result ?? null,
        costUsd: r.total_cost_usd ?? 0,
        durationSec: (r.duration_ms ?? 0) / 1000,
      },
    ]
  }
  const message = MessageLine.safeParse(raw)
  if (message.success && Array.isArray(message.data.message.content)) {
    return message.data.message.content.map(blockBody)
  }
  return [unknownBody(raw)]
}

export const parseStreamJsonLine = (line: string): StreamJsonLineResult => {
  const trimmed = line.trim()
  if (trimmed === '') return { bodies: [], cliSessionId: null }
  const parsed = ((): { ok: true; value: unknown } | { ok: false } => {
    try {
      return { ok: true, value: JSON.parse(trimmed) as unknown }
    } catch {
      // 読めない行は捨てずに残す（下で unparsable にする）。
      return { ok: false }
    }
  })()
  if (!parsed.ok) {
    return { bodies: [{ kind: 'system', event: 'unparsable', text: truncate(trimmed, TOOL_RESULT_TEXT_MAX), raw: null }], cliSessionId: null }
  }
  const envelope = Envelope.safeParse(parsed.value)
  if (!envelope.success) return { bodies: [unknownBody(parsed.value)], cliSessionId: null }
  return { bodies: bodiesOf(parsed.value), cliSessionId: envelope.data.session_id ?? null }
}
