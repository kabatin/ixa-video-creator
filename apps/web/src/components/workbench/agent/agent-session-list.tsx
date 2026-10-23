'use client'

import { useState } from 'react'
import { filterAgentSessions } from '@ixa/domain'
import { Button } from '@/components/ui/button'
import type { WireAgentSession } from '@/lib/agent-api'
import { AGENT_STATUS_LABELS } from '@/lib/agent-messages'

/**
 * 作業を継続: この作品の会話の一覧（ADR-0058）。カードで並ぶ（確認待ち・作業中が上、残りは新しい順。並びは API）。
 * 題名は鉛筆から直せる。上の欄で絞り込む（題名と最後の返事の要約）。
 */

const STATUS_TONES = {
  running: 'border-info/50 text-info',
  awaiting_approval: 'border-warn/50 text-warn',
  idle: 'border-line text-muted',
  interrupted: 'border-line text-muted',
  error: 'border-danger/50 text-danger',
} as const

const formatWhen = (iso: string): string => {
  const date = new Date(iso)
  return `${String(date.getMonth() + 1)}/${String(date.getDate())} ${String(date.getHours())}:${String(date.getMinutes()).padStart(2, '0')}`
}

const SessionCard = ({
  session,
  onOpen,
  onRename,
}: {
  readonly session: WireAgentSession
  readonly onOpen: () => void
  readonly onRename: (title: string) => void
}) => {
  const [editing, setEditing] = useState<string | null>(null)
  const commit = (): void => {
    if (editing !== null && editing.trim() !== '' && editing.trim() !== session.title) onRename(editing.trim())
    setEditing(null)
  }
  return (
    <li className="rounded-md border border-line bg-surface hover:bg-surface-2">
      <div className="flex items-start gap-2 p-2">
        <div className="min-w-0 flex-1">
          {editing === null ? (
            <button type="button" className="block w-full truncate text-left text-sm font-semibold text-text" onClick={onOpen}>
              {session.title}
            </button>
          ) : (
            <input
              aria-label="題名"
              autoFocus
              maxLength={80}
              className="w-full rounded border border-line bg-bg px-1 text-sm text-text"
              value={editing}
              onChange={(event) => setEditing(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) commit()
                if (event.key === 'Escape') setEditing(null)
              }}
            />
          )}
          <p className="truncate text-xs text-muted">{session.lastSummary ?? 'まだ返事はありません'}</p>
          <p className="text-xs text-muted">
            {formatWhen(session.lastActiveAt)} ・ 直した数 {String(session.editCount)}
          </p>
        </div>
        <span className={`shrink-0 rounded border px-1.5 text-xs ${STATUS_TONES[session.status]}`}>
          {AGENT_STATUS_LABELS[session.status]}
        </span>
        <button
          type="button"
          aria-label={`「${session.title}」の題名を直す`}
          className="shrink-0 text-xs text-muted hover:text-text"
          onClick={() => setEditing(session.title)}
        >
          ✎
        </button>
      </div>
    </li>
  )
}

export const AgentSessionList = ({
  sessions,
  onOpen,
  onRename,
  onBack,
}: {
  readonly sessions: readonly WireAgentSession[] | null
  readonly onOpen: (session: WireAgentSession) => void
  readonly onRename: (session: WireAgentSession, title: string) => void
  readonly onBack: () => void
}) => {
  const [query, setQuery] = useState('')
  const shown = sessions === null ? null : filterAgentSessions(sessions, query)
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onBack}>
          戻る
        </Button>
        <input
          aria-label="会話を絞り込む"
          placeholder="題名・最後の返事で絞り込む"
          className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-sm text-text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {shown === null ? (
        <p className="text-sm text-muted">会話を読み込んでいます…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">{sessions?.length === 0 ? 'まだ会話はありません。' : '当てはまる会話はありません。'}</p>
      ) : (
        <ul className="relative space-y-2 overflow-auto" aria-label="会話">
          {shown.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onOpen={() => onOpen(session)}
              onRename={(title) => onRename(session, title)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
