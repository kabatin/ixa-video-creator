import type { AgentApprovalDecision, AgentSessionId, ToolRisk } from '@ixa/domain'

/**
 * 確認の待ち（ADR-0058）。MCP の `approve` が頼み、画面の答えを待つあいだ、ここに置く。
 *
 * **API のプロセスの中だけに持つ。** CLI もこのプロセスが起こしているので、API が落ちれば CLI も止まり、
 * 待ちが残っても意味が無い（起動時に会話は中断にする）。頼んだことと答えは会話の行として DB に残る。
 */

export type PendingApproval = {
  readonly requestId: string
  readonly sessionId: AgentSessionId
  /** 頼まれたツール（CLI の名前）。「実行」で API が自分ですること（確認なしへの切り替え）を見分ける。 */
  readonly toolName: string
  readonly decision: AgentApprovalDecision | null
  readonly message: string | null
}

export type AgentApprovals = {
  readonly open: (sessionId: AgentSessionId, requestId: string, toolName: string) => void
  readonly find: (requestId: string) => PendingApproval | null
  /** 答える。まだ答えていない待ちだけ。答えたら true。 */
  readonly decide: (requestId: string, decision: AgentApprovalDecision, message: string | null) => boolean
  /** 会話のまだ答えていない待ちの数。 */
  readonly openCount: (sessionId: AgentSessionId) => number
  /** 会話のまだ答えていない待ちを、すべて断る（止めた・やりとりが終わった）。 */
  readonly denyAll: (sessionId: AgentSessionId, message: string) => void
  /** 会話の待ちを忘れる（やりとりが終わったあと）。 */
  readonly forget: (sessionId: AgentSessionId) => void
  /** ツールの呼び出し（tool_use_id）ごとの危険度。やりとりの「直した数」を数えるのに使う。 */
  readonly noteRisk: (sessionId: AgentSessionId, toolUseId: string, risk: ToolRisk) => void
  readonly riskOf: (sessionId: AgentSessionId, toolUseId: string) => ToolRisk | null
}

export const createAgentApprovals = (): AgentApprovals => {
  let pending: ReadonlyMap<string, PendingApproval> = new Map()
  let risks: ReadonlyMap<string, ToolRisk> = new Map()
  const riskKey = (sessionId: string, toolUseId: string): string => `${sessionId}:${toolUseId}`
  const replace = (requestId: string, next: PendingApproval): void => {
    pending = new Map([...pending, [requestId, next]])
  }
  return {
    open: (sessionId, requestId, toolName) =>
      replace(requestId, { requestId, sessionId, toolName, decision: null, message: null }),
    find: (requestId) => pending.get(requestId) ?? null,
    decide: (requestId, decision, message) => {
      const current = pending.get(requestId)
      if (current === undefined || current.decision !== null) return false
      replace(requestId, { ...current, decision, message })
      return true
    },
    openCount: (sessionId) => [...pending.values()].filter((p) => p.sessionId === sessionId && p.decision === null).length,
    denyAll: (sessionId, message) => {
      pending = new Map(
        [...pending].map(([id, p]) =>
          p.sessionId === sessionId && p.decision === null ? [id, { ...p, decision: 'deny', message }] : [id, p],
        ),
      )
    },
    forget: (sessionId) => {
      pending = new Map([...pending].filter(([, p]) => p.sessionId !== sessionId))
      risks = new Map([...risks].filter(([key]) => !key.startsWith(`${sessionId}:`)))
    },
    noteRisk: (sessionId, toolUseId, risk) => {
      risks = new Map([...risks, [riskKey(sessionId, toolUseId), risk]])
    },
    riskOf: (sessionId, toolUseId) => risks.get(riskKey(sessionId, toolUseId)) ?? null,
  }
}
