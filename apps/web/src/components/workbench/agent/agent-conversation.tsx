'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShotId } from '@ixa/domain'
import { Button } from '@/components/ui/button'
import { AgentComposer } from '@/components/workbench/agent/agent-composer'
import { AgentItemView } from '@/components/workbench/agent/agent-items'
import { PanelNotice } from '@/components/workbench/panels/panel-frame'
import type { AgentApi, WireAgentSession } from '@/lib/agent-api'
import { agentItemsFrom, AGENT_STATUS_LABELS } from '@/lib/agent-messages'
import { describeError } from '@/lib/api-error'
import { useAgentStream } from '@/lib/use-agent-stream'

/**
 * 会話の中（ADR-0058）。流れてくる行を並べ、下に入力欄を置く。確認なしのときは帯を出し、いつでも戻せる。
 * 文脈（開いている作品・選んでいる Shot・再生位置）は送るたびに `contextOf` から添える。
 */
export const AgentConversation = ({
  api,
  baseUrl,
  initial,
  contextOf,
  onEdited,
  onBack,
}: {
  readonly api: AgentApi
  readonly baseUrl: string
  readonly initial: WireAgentSession
  readonly contextOf: () => { readonly shotId: ShotId | null; readonly playheadSec: number }
  readonly onEdited: () => void
  readonly onBack: () => void
}) => {
  const stream = useAgentStream({ baseUrl, sessionId: initial.id, onEdited })
  const session = stream.session ?? initial
  const items = useMemo(() => agentItemsFrom(stream.messages), [stream.messages])
  const [error, setError] = useState<string | null>(null)
  const [answering, setAnswering] = useState(false)
  const busy = session.status === 'running' || session.status === 'awaiting_approval'

  const bottom = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [items.length])

  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setError(null)
    try {
      await action()
      return true
    } catch (caught) {
      setError(describeError(caught))
      return false
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line pb-1">
        <Button size="sm" onClick={onBack}>
          一覧へ
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{session.title}</p>
        <span className="shrink-0 text-xs text-muted">{AGENT_STATUS_LABELS[session.status]}</span>
      </div>
      {session.confirmationsWaived && (
        <div role="status" className="mt-1 flex shrink-0 flex-wrap items-center gap-2 rounded border border-warn/50 bg-warn/10 px-2 py-1 text-xs text-warn">
          このタスクでは、生成・削除・書き出し・設定の変更も確認せずに進めます。
          <Button size="sm" onClick={() => void run(() => api.update(session.id, { confirmationsWaived: false }))}>
            確認を出すように戻す
          </Button>
        </div>
      )}
      {error !== null && <div className="mt-1"><PanelNotice tone="danger">{error}</PanelNotice></div>}
      <div className="relative min-h-0 flex-1 space-y-2 overflow-auto py-2" aria-live="polite">
        {items.length === 0 && (
          <p className="text-sm text-muted">
            {stream.connected ? '頼みたいことを書いてください。開いている Shot と再生位置は自動で添えます。' : '会話を読み込んでいます…'}
          </p>
        )}
        {items.map((item) => (
          <AgentItemView
            key={item.seq}
            item={item}
            handlers={{
              answering,
              onAnswer: (requestId, decision, waiveAfter) => {
                setAnswering(true)
                void run(() => api.answer(session.id, requestId, { decision, waiveAfter })).finally(() => setAnswering(false))
              },
            }}
          />
        ))}
        <div ref={bottom} />
      </div>
      <AgentComposer
        busy={busy}
        model={session.model}
        onModelChange={(model) => void run(() => api.update(session.id, { model }))}
        onStop={() => void run(() => api.stop(session.id))}
        onSend={(text) => {
          const context = contextOf()
          return run(() =>
            api.send(session.id, { text, context: { shotId: context.shotId, playheadSec: context.playheadSec } }),
          )
        }}
      />
    </div>
  )
}
