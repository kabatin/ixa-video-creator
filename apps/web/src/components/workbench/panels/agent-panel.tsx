'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentConversation } from '@/components/workbench/agent/agent-conversation'
import { AgentSessionList } from '@/components/workbench/agent/agent-session-list'
import { useTimelineMaterials } from '@/components/workbench/timeline-materials-provider'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelFrame, PanelNotice } from '@/components/workbench/panels/panel-frame'
import { createAgentApi, DEFAULT_AGENT_MODEL, type WireAgentSession } from '@/lib/agent-api'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createRequester } from '@/lib/requester'

/**
 * AI エージェント（下の区画。ADR-0058。制作者の要望 2026-10-23）。ixa の MCP でできる操作を、チャットで頼む。
 *
 * 開いたときは大きなボタンが 2 つだけ（新しいタスク／作業を継続）。継続は、この作品の会話の一覧から選ぶ。
 * エージェントが作品を書き換えたら、作品を読み直す（タイムラインにその場で出る。⌘Z の取り消しの履歴にも載る）。
 */

type View = { readonly kind: 'home' } | { readonly kind: 'list' } | { readonly kind: 'talk'; readonly session: WireAgentSession }

/** 「直した」が続けて届いたら、まとめて 1 回読み直す。 */
const EDITED_DEBOUNCE_MS = 600

export const AgentPanel = () => {
  const workbench = useWorkbench()
  const { reload: reloadTimeline } = useTimelineMaterials()
  const baseUrl = useMemo(() => resolveApiBaseUrl(), [])
  const api = useMemo(() => createAgentApi(createRequester(baseUrl)), [baseUrl])
  const [view, setView] = useState<View>({ kind: 'home' })
  const [sessions, setSessions] = useState<readonly WireAgentSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const { projectId, selectedShotId, transportControls, refresh, bumpSfx } = workbench

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      setSessions(await api.list(projectId))
    } catch (caught) {
      setError(describeError(caught))
    }
  }, [api, projectId])
  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const editedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (editedTimer.current !== null) clearTimeout(editedTimer.current)
  }, [])
  const onEdited = useCallback((): void => {
    if (editedTimer.current !== null) clearTimeout(editedTimer.current)
    editedTimer.current = setTimeout(() => {
      editedTimer.current = null
      refresh()
      reloadTimeline()
      bumpSfx()
    }, EDITED_DEBOUNCE_MS)
  }, [refresh, reloadTimeline, bumpSfx])

  const contextOf = useCallback(
    () => ({ shotId: selectedShotId, playheadSec: transportControls.getTransport().currentSec }),
    [selectedShotId, transportControls],
  )

  const startNew = async (): Promise<void> => {
    setError(null)
    setCreating(true)
    try {
      const session = await api.create(projectId, DEFAULT_AGENT_MODEL)
      setView({ kind: 'talk', session })
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setCreating(false)
    }
  }

  const rename = async (session: WireAgentSession, title: string): Promise<void> => {
    setError(null)
    try {
      await api.update(session.id, { title })
      await loadSessions()
    } catch (caught) {
      setError(describeError(caught))
    }
  }

  return (
    <PanelFrame>
      {error !== null && <PanelNotice tone="danger">{error}</PanelNotice>}
      {view.kind === 'home' && (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
          <p className="max-w-md text-center text-sm text-muted">
            作品の直しをチャットで頼めます。生成・削除・書き出しの前には確認を出します。
          </p>
          <div className="grid w-full max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={creating}
              className="rounded-lg border border-accent bg-accent/10 px-4 py-6 text-base font-semibold text-text hover:bg-accent/20 disabled:opacity-60"
              onClick={() => void startNew()}
            >
              新しいタスク
            </button>
            <button
              type="button"
              className="rounded-lg border border-line-strong bg-surface px-4 py-6 text-base font-semibold text-text hover:bg-surface-2"
              onClick={() => {
                setView({ kind: 'list' })
                void loadSessions()
              }}
            >
              作業を継続
              {sessions !== null && <span className="block text-xs font-normal text-muted">{`${String(sessions.length)} 件の会話`}</span>}
            </button>
          </div>
        </div>
      )}
      {view.kind === 'list' && (
        <AgentSessionList
          sessions={sessions}
          onBack={() => setView({ kind: 'home' })}
          onOpen={(session) => setView({ kind: 'talk', session })}
          onRename={(session, title) => void rename(session, title)}
        />
      )}
      {view.kind === 'talk' && (
        <AgentConversation
          key={view.session.id}
          api={api}
          baseUrl={baseUrl}
          initial={view.session}
          contextOf={contextOf}
          onEdited={onEdited}
          onBack={() => {
            setView({ kind: 'list' })
            void loadSessions()
          }}
        />
      )}
    </PanelFrame>
  )
}
