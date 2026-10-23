import { AgentApprovalDecision, ToolRisk, toolRisk } from '@ixa/domain'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { seg } from '../api-client.js'
import { defineTool, describeError, errorResult, jsonResult, type ToolDeps } from '../tool-def.js'

/**
 * AI エージェントの会話の中だけで使うツール（ADR-0058）。API がエージェントの Claude CLI を起こすときに
 * env の `IXA_AGENT_SESSION_ID` を渡し、あるときだけ登録する（server.ts）。
 *
 *   POST  /agent-sessions/{id}/approvals { toolName, toolUseId, risk, input } → { requestId, decision|null, message }
 *   GET   /agent-sessions/{id}/approvals/{requestId} → { decision|null, message }
 *   PATCH /agent-sessions/{id} { confirmationsWaived: true }
 *
 * `approve` は Claude CLI の `--permission-prompt-tool`。CLI はツールを使う前にこれを呼び、
 * `{behavior:"allow",updatedInput}` か `{behavior:"deny",message}` の JSON を text で受ける（CLI 2.1.289 で確かめた）。
 * **どのツールでも API に印を知らせる。** 確認が要るか（確認なしの旗を含む）は API が domain の `approvalNeeded` で決め、
 * 要らなければすぐ許す（読むだけ・ふつうの書き込みは待たない）。API は印から「直した数」を数える。
 */

/** 答えを聞き直す間隔（ミリ秒）。最初は短く、だんだん延ばす。 */
const POLL_START_MS = 1000
const POLL_MAX_MS = 5000
/** これより長く答えが無ければ断る（制作者が席を外している）。 */
const APPROVAL_TIMEOUT_MS = 60 * 60 * 1000

const DENIED_BY_CREATOR = '制作者が「やめる」を選びました。別のやり方を提案するか、次の指示を待ってください。'
const TIMED_OUT = '確認の返事が 1 時間ありませんでした。実行していません。'

const WireApprovalStarted = z.object({
  requestId: z.string().ulid(),
  decision: AgentApprovalDecision.nullable(),
  message: z.string().nullable(),
})
const WireApprovalState = z.object({ decision: AgentApprovalDecision.nullable(), message: z.string().nullable() })

const allow = (input: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ behavior: 'allow', updatedInput: input }) }],
})
const deny = (message: string): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ behavior: 'deny', message }) }],
})

const decide = (decision: AgentApprovalDecision, message: string | null, input: unknown): CallToolResult =>
  decision === 'allow' ? allow(input) : deny(message ?? DENIED_BY_CREATOR)

const waitForAnswer = async (
  deps: ToolDeps,
  sessionId: string,
  requestId: string,
  input: unknown,
): Promise<CallToolResult> => {
  const startedAt = deps.clock.now()
  const poll = async (delayMs: number): Promise<CallToolResult> => {
    if (deps.clock.now() - startedAt >= APPROVAL_TIMEOUT_MS) return deny(TIMED_OUT)
    await deps.clock.sleep(delayMs)
    const state = await deps.api.get(`/agent-sessions/${seg(sessionId)}/approvals/${seg(requestId)}`, WireApprovalState)
    if (state.decision !== null) return decide(state.decision, state.message, input)
    return poll(Math.min(POLL_MAX_MS, delayMs * 2))
  }
  return poll(POLL_START_MS)
}

export const ApproveInput = z.object({
  tool_name: z.string().min(1),
  input: z.unknown(),
  tool_use_id: z.string().optional(),
})

/** 危険度の表（ツール名 → 印）は server.ts が全ツールから組んで渡す（ツールの一覧を写さない）。 */
export const createApproveTool = (risks: ReadonlyMap<string, ToolRisk>) =>
  defineTool({
    name: 'approve',
    risk: 'read',
    description:
      'Permission prompt for the ixa agent chat (called by Claude Code itself before a tool runs; do not call it ' +
      'yourself). Read-only and ordinary edits are allowed at once; generation, deletion, export and settings ask the ' +
      'creator on screen (unless confirmations are waived) and wait for the answer.',
    input: ApproveInput,
    handler: async ({ tool_name: toolName, input, tool_use_id: toolUseId }, deps) => {
      const sessionId = deps.agentSessionId
      if (sessionId === undefined) return deny('AI エージェントの会話の外では確認できません。')
      const risk = toolRisk(toolName, risks)
      try {
        const started = await deps.api.post(
          `/agent-sessions/${seg(sessionId)}/approvals`,
          { toolName, toolUseId: toolUseId ?? null, risk, input },
          WireApprovalStarted,
        )
        if (started.decision !== null) return decide(started.decision, started.message, input)
        return await waitForAnswer(deps, sessionId, started.requestId, input)
      } catch (error) {
        deps.logger.warn({ tool: 'approve', err: error }, '確認を頼めませんでした')
        // 読むだけなら止める理由が無い。それ以外は、確かめられなければ実行させない（黙って許さない）。
        if (risk === 'read') return allow(input)
        return deny(`確認を頼めなかったので実行していません — ${describeError(error)}`)
      }
    },
  })

/**
 * 確認なしに切り替える。**設定の変更として確認に回る**（ツールの結果に混ざった文に誘導されても、
 * 制作者がカードで「実行」しない限り旗は立たない）。旗を立てるのは「実行」を受けた API で、ここは旗を読むだけ。
 */
export const waiveConfirmationsTool = defineTool({
  name: 'waive_confirmations',
  risk: 'settings',
  description:
    'Stop asking the creator before generation, deletion, export and settings changes, for this chat task only. ' +
    'Call it ONLY when the creator clearly says so (e.g. 「確認なしでいい」「いちいち聞かなくていい」). ' +
    'The creator is asked to confirm on screen first. The screen shows a banner and the creator can turn ' +
    'confirmations back on at any time.',
  input: z.object({}),
  handler: async (_args, deps) => {
    const sessionId = deps.agentSessionId
    if (sessionId === undefined) return errorResult('AI エージェントの会話の外では使えません。')
    const session = await deps.api.get(`/agent-sessions/${seg(sessionId)}`, z.object({ confirmationsWaived: z.boolean() }))
    return jsonResult({ confirmationsWaived: session.confirmationsWaived })
  },
})
