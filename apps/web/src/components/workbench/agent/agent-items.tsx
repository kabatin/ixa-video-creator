'use client'

import { useEffect, useState } from 'react'
import type { ToolRisk } from '@ixa/domain'
import { Button } from '@/components/ui/button'
import { AgentText } from '@/components/workbench/agent/agent-text'
import type { AgentItem } from '@/lib/agent-messages'
import { formatClock, formatElapsed } from '@/lib/format-time'

/**
 * 会話の 1 項目を描く（ADR-0058）。制作者は右の吹き出し、エージェントは左に整形した文章。
 * 操作は 1 行ずつ畳み、押すと頼んだ内容と結果の要約が開く。確認はカードで出す。
 */

const RISK_NOTES: Readonly<Record<ToolRisk, string>> = Object.freeze({
  read: '',
  write: '',
  costly: '時間か費用が掛かります。',
  destructive: '消す、またはこの作品の外を触る操作です。元に戻せないことがあります。',
  settings: '設定を変えます。',
})

const UserBubble = ({ item }: { readonly item: Extract<AgentItem, { kind: 'user' }> }) => {
  const context = [
    item.context?.shotLabel ?? null,
    item.context?.playheadSec === null || item.context?.playheadSec === undefined ? null : formatClock(item.context.playheadSec),
  ].filter((part): part is string => part !== null)
  return (
    <div className="flex flex-col items-end gap-0.5">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-accent px-3 py-2 text-sm text-accent-fg">{item.text}</p>
      {context.length > 0 && <span className="text-xs text-muted">{context.join(' ・ ')}</span>}
    </div>
  )
}

const useElapsed = (since: string, running: boolean): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return Math.max(0, (now - new Date(since).getTime()) / 1000)
}

const TOOL_MARKS = { running: '⋯', done: '✓', failed: '✕' } as const
const TOOL_TONES = { running: 'text-muted', done: 'text-ok', failed: 'text-danger' } as const

const ToolLine = ({ item }: { readonly item: Extract<AgentItem, { kind: 'tool' }> }) => {
  const elapsed = useElapsed(item.startedAt, item.state === 'running')
  return (
    <details className="group rounded border border-line bg-surface text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1">
        <span className={`w-3 shrink-0 text-center ${TOOL_TONES[item.state]}`} aria-hidden>{TOOL_MARKS[item.state]}</span>
        <span className="min-w-0 flex-1 truncate text-text">{item.title}</span>
        {item.state === 'running' && <span className="tabular-nums text-muted">{formatElapsed(elapsed)}</span>}
      </summary>
      <div className="space-y-1 border-t border-line px-2 py-1 text-muted">
        {item.request.length > 0 && (
          <div>
            <p className="font-semibold">頼んだ内容</p>
            <ul className="break-words font-mono">{item.request.map((line, i) => <li key={i}>{line}</li>)}</ul>
          </div>
        )}
        <div>
          <p className="font-semibold">結果</p>
          <p className="whitespace-pre-wrap break-words font-mono">{item.result ?? 'まだです'}</p>
        </div>
      </div>
    </details>
  )
}

const APPROVAL_RESULTS = {
  allowed: '実行しました',
  denied: 'やめました',
  expired: '答える前にやりとりが終わりました',
  timedOut: '1 時間答えが無かったので、やめました',
} as const

export type ApprovalHandlers = {
  readonly onAnswer: (requestId: string, decision: 'allow' | 'deny', waiveAfter: boolean) => void
  readonly answering: boolean
}

const ApprovalCard = ({ item, handlers }: { readonly item: Extract<AgentItem, { kind: 'approval' }>; readonly handlers: ApprovalHandlers }) => (
  <div role={item.state === 'pending' ? 'alert' : undefined} className="rounded-md border border-warn/50 bg-warn/10 p-2 text-sm">
    <p className="font-semibold text-text">{item.title}</p>
    {RISK_NOTES[item.risk] !== '' && <p className="text-xs text-muted">{RISK_NOTES[item.risk]}</p>}
    {item.reason !== null && <p className="text-xs text-muted">確認なしにしていても確かめます: {item.reason}</p>}
    {item.state === 'pending' ? (
      <div className="mt-2 flex flex-wrap gap-2">
        <Button tone="primary" size="sm" disabled={handlers.answering} onClick={() => handlers.onAnswer(item.requestId, 'allow', false)}>
          実行
        </Button>
        <Button size="sm" disabled={handlers.answering} onClick={() => handlers.onAnswer(item.requestId, 'deny', false)}>
          やめる
        </Button>
        <Button size="sm" disabled={handlers.answering} onClick={() => handlers.onAnswer(item.requestId, 'allow', true)}>
          以後このタスクでは確認しない
        </Button>
      </div>
    ) : (
      <p className="mt-1 text-xs text-muted">{APPROVAL_RESULTS[item.state]}</p>
    )}
  </div>
)

const NOTICE_TONES = {
  info: 'border-info/40 bg-info/10 text-info',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  danger: 'border-danger/40 bg-danger/10 text-danger',
} as const

export const AgentItemView = ({ item, handlers }: { readonly item: AgentItem; readonly handlers: ApprovalHandlers }) => {
  switch (item.kind) {
    case 'user':
      return <UserBubble item={item} />
    case 'assistant':
      return <div className="max-w-[95%]"><AgentText text={item.text} /></div>
    case 'tool':
      return <ToolLine item={item} />
    case 'approval':
      return <ApprovalCard item={item} handlers={handlers} />
    case 'notice':
      return <p className={`rounded border px-2 py-1 text-xs ${NOTICE_TONES[item.tone]}`}>{item.text}</p>
  }
}
