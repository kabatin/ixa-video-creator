'use client'

import { useEffect, useRef, useState } from 'react'
import { agentStreamUrl, WireAgentMessage, WireAgentSession } from '@/lib/agent-api'
import { mergeAgentMessages } from '@/lib/agent-messages'
import { reconnectDelayMs } from '@/lib/project-events'

/**
 * 会話の流れを SSE で受けるフック（ADR-0058）。行は通し番号の順に並べ、同じ番号は 1 つにする。
 *
 * **繋ぎ直すときは `?after=<最後の番号>` で続きから受ける。** EventSource を作り直すと
 * ブラウザは `Last-Event-ID` を送らないので、自分で番号を持つ。
 * 最初の描画では繋がない（サーバに EventSource は無い。lessons L-019）。
 */

export type AgentStream = {
  readonly messages: readonly WireAgentMessage[]
  readonly session: WireAgentSession | null
  /** 繋がっている（最初の `session` が届いた）。 */
  readonly connected: boolean
}

const parseJson = (event: Event): unknown => {
  const data: unknown = (event as MessageEvent<unknown>).data
  if (typeof data !== 'string') return null
  try {
    return JSON.parse(data) as unknown
  } catch {
    return null
  }
}

export const useAgentStream = (input: {
  readonly baseUrl: string
  readonly sessionId: string | null
  /** 作品を書き換えた（読むだけ以外の操作が成功した）。 */
  readonly onEdited: () => void
}): AgentStream => {
  const { baseUrl, sessionId } = input
  const [messages, setMessages] = useState<readonly WireAgentMessage[]>([])
  const [session, setSession] = useState<WireAgentSession | null>(null)
  const [connected, setConnected] = useState(false)
  const onEditedRef = useRef(input.onEdited)
  useEffect(() => {
    onEditedRef.current = input.onEdited
  })

  useEffect(() => {
    setMessages([])
    setSession(null)
    setConnected(false)
    if (sessionId === null || typeof EventSource === 'undefined') return undefined

    let disposed = false
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    let lastSeq = 0

    const connect = (): void => {
      if (disposed) return
      const opened = new EventSource(agentStreamUrl(baseUrl, sessionId, lastSeq), { withCredentials: true })
      source = opened
      opened.addEventListener('session', (event) => {
        const parsed = WireAgentSession.safeParse(parseJson(event))
        if (!parsed.success || disposed) return
        failures = 0
        setConnected(true)
        setSession(parsed.data)
      })
      opened.addEventListener('message', (event) => {
        const parsed = WireAgentMessage.safeParse(parseJson(event))
        if (!parsed.success || disposed) return
        lastSeq = Math.max(lastSeq, parsed.data.seq)
        setMessages((current) => mergeAgentMessages(current, [parsed.data]))
      })
      opened.addEventListener('edited', () => {
        if (!disposed) onEditedRef.current()
      })
      opened.addEventListener('error', () => {
        opened.close()
        if (disposed) return
        failures += 1
        setConnected(false)
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(connect, reconnectDelayMs(failures))
      })
    }

    connect()
    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      source?.close()
    }
  }, [baseUrl, sessionId])

  return { messages, session, connected }
}
