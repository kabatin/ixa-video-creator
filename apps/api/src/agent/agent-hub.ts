import type { AgentMessage, AgentSession, AgentSessionId } from '@ixa/domain'

/**
 * 会話ごとの流れ（ADR-0058）。会話の行・会話の状態・「作品を直した」を、その会話を開いている画面へ配る。
 *
 * 作品の SSE（`routes/events.ts`）は全員に届き、取りこぼしを再送しない作りなので使わない。
 * ここは API のプロセスの中だけで配る（CLI もこのプロセスが起こすので、外から流れてくるものは無い）。
 * 取りこぼしは、行が DB にあるので、画面が通し番号の続きから読み直して埋める。
 */
export type AgentStreamEvent =
  | { readonly type: 'message'; readonly message: AgentMessage }
  | { readonly type: 'session'; readonly session: AgentSession }
  /** 作品を書き換えた（読むだけ以外の操作が成功した）。画面はタイムラインを読み直す。 */
  | { readonly type: 'edited' }

export type AgentStreamListener = (event: AgentStreamEvent) => void

export type AgentHub = {
  readonly publish: (sessionId: AgentSessionId, event: AgentStreamEvent) => void
  /** 受け取りを始める。戻り値を呼ぶと止める。 */
  readonly subscribe: (sessionId: AgentSessionId, listener: AgentStreamListener) => () => void
}

export const createAgentHub = (onListenerError: (error: unknown) => void): AgentHub => {
  const listeners = new Map<AgentSessionId, ReadonlySet<AgentStreamListener>>()
  return {
    publish: (sessionId, event) => {
      for (const listener of listeners.get(sessionId) ?? []) {
        try {
          listener(event)
        } catch (error) {
          // 1 本の接続の失敗で、ほかの接続への配りを止めない。
          onListenerError(error)
        }
      }
    },
    subscribe: (sessionId, listener) => {
      listeners.set(sessionId, new Set([...(listeners.get(sessionId) ?? []), listener]))
      return () => {
        const rest = [...(listeners.get(sessionId) ?? [])].filter((l) => l !== listener)
        if (rest.length === 0) listeners.delete(sessionId)
        else listeners.set(sessionId, new Set(rest))
      }
    },
  }
}
