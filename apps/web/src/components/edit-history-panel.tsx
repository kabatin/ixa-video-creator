'use client'

import type { EditBatchId, ProjectId, ShotId } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createRequester } from '@/lib/requester'
import {
  buildEditHistoryView,
  buildUndoResultView,
  editHistoryShotLabel,
  type EditHistoryTone,
  type UndoResultView,
} from '@/lib/edit-history'
import {
  createEditHistoryApi,
  type EditHistoryApi,
  type WireEditBatch,
} from '@/lib/edit-history-api'
import { Button } from '@/components/ui/button'

/**
 * 一括で変えた操作を並べ、まだ戻していないものに「元に戻す」を出す（P64-1）。
 *
 * ★ **取り消し済みの行を消さない。** 消すと「取り消した」という事実まで
 *   履歴から消える。取り消した旨を出したまま残す。
 *
 * ★ **戻せなかったものは件数に畳まず、1 件ずつ理由を出す**（lessons L-015）。
 *   Shot が消えていた・他 Project のものだった、を人が探せるようにする。
 *
 * 判定と言葉は `lib/edit-history.ts` が持つ。ここは描くのと、押した先を繋ぐだけ。
 */

/** 色は役割の名前で持つ（PHASE 5.9）。素の色名はここに書かない。 */
const TONE_CLASSES: Readonly<Record<EditHistoryTone, string>> = {
  normal: 'text-text',
  muted: 'text-muted',
  warn: 'text-warn',
}

export type EditHistoryPanelProps = {
  readonly projectId: ProjectId
  /** Shot の見出しに使う `code`。渡さなければ ID をそのまま出す。 */
  readonly shotCodes?: ReadonlyMap<ShotId, string>
  /** 1 件でも戻ったあとに呼ばれる。親が一覧を読み直すための口。 */
  readonly onUndone?: () => void
  /** テストから差し替えるための注入口。 */
  readonly api?: EditHistoryApi
}

type Phase = 'loading' | 'idle' | 'undoing'

export const EditHistoryPanel = ({
  projectId,
  shotCodes,
  onUndone,
  api,
}: EditHistoryPanelProps) => {
  const client = useMemo(
    () => api ?? createEditHistoryApi(createRequester(resolveApiBaseUrl())),
    [api],
  )

  const [phase, setPhase] = useState<Phase>('loading')
  const [batches, setBatches] = useState<readonly WireEditBatch[]>([])
  const [undoView, setUndoView] = useState<UndoResultView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setPhase('loading')
    setError(null)

    client
      .listEditBatches(projectId)
      .then((loaded) => {
        setBatches(loaded)
      })
      .catch((cause: unknown) => {
        // 握り潰さない。読めなかったことを画面に出す（規約 5 / lessons L-015）。
        setError(describeError(cause))
      })
      .finally(() => {
        setPhase('idle')
      })
  }, [client, projectId])

  useEffect(load, [load])

  const runUndo = useCallback(
    (id: EditBatchId) => {
      setPhase('undoing')
      setError(null)
      setUndoView(null)

      client
        .undoEditBatch(projectId, id)
        .then((result) => {
          setUndoView(buildUndoResultView(result))
          /**
           * **消さずに差し替える。** 取り消した行は「取り消し済み」として残す。
           * 消すと、何が起きたのかが履歴から失われる。
           */
          setBatches((current) =>
            current.map((batch) => (batch.id === result.batch.id ? result.batch : batch)),
          )
          if (result.restored.length > 0 || result.restoredClips.length > 0) onUndone?.()
        })
        .catch((cause: unknown) => {
          setError(describeError(cause))
        })
        .finally(() => {
          setPhase('idle')
        })
    },
    [client, projectId, onUndone],
  )

  const view = buildEditHistoryView(batches)
  const label = (shotId: ShotId): string => editHistoryShotLabel(shotId, shotCodes)

  return (
    <section className="rounded-lg border border-line bg-surface p-4" aria-label="変更の履歴">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">変更の履歴</h2>
        <button
          type="button"
          onClick={load}
          disabled={phase !== 'idle'}
          className="rounded border border-line px-2 py-1 text-xs text-text disabled:opacity-50"
        >
          {phase === 'loading' ? '読み込み中です' : '読み直す'}
        </button>
      </div>

      {/* **戻せる範囲を先に書く。** 1 打鍵ずつは戻せないことを隠さない。 */}
      <p className="mt-2 text-xs text-muted">
        まとめて変えた操作だけを戻せます。1 つずつの編集は戻せません。
      </p>

      {error === null ? null : (
        <p role="alert" className="mt-2 text-sm text-danger">
          変更の履歴を扱えませんでした（{error}）
        </p>
      )}

      <p className="mt-3 text-xs text-muted" role="status">
        {view.summary}
      </p>

      {view.isEmpty ? null : (
        <ul className="mt-2 space-y-2">
          {view.rows.map((row) => (
            <li key={row.key} className="rounded border border-line p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`text-sm ${TONE_CLASSES[row.tone]}`}>{row.summary}</p>
                  <p className="mt-1 text-xs text-muted">
                    {row.kindLabel}・{row.shotCountLabel}・{row.when}
                  </p>
                  {/* 取り消し済みは消さずに、その旨を出す。 */}
                  {row.undoneAt === null ? null : (
                    <p className="mt-1 text-xs text-muted">{row.undoneAt} に取り消し済み</p>
                  )}
                </div>
                {row.canUndo ? (
                  <Button
                    tone="primary"
                    size="sm"
                    nowrap
                    onClick={() => {
                      runUndo(row.id)
                    }}
                    disabled={phase !== 'idle'}
                  >
                    {phase === 'undoing' ? '戻しています' : '元に戻す'}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {undoView === null ? null : (
        <div className="mt-3 border-t border-line pt-3">
          <p className={`text-xs ${TONE_CLASSES[undoView.tone]}`} role="status">
            {undoView.summary}
          </p>
          {/* 戻せなかった分は 1 件ずつ理由を出す。件数だけでは探しに行けない。 */}
          {undoView.failed.length === 0 ? null : (
            <ul className="mt-1 space-y-1">
              {undoView.failed.map((entry) => (
                <li key={entry.key} className="text-xs text-muted">
                  <span className="text-text">{label(entry.shotId)}</span> — {entry.reason}
                </li>
              ))}
            </ul>
          )}
          {undoView.failedClips.length === 0 ? null : (
            <ul className="mt-1 space-y-1">
              {undoView.failedClips.map((entry) => (
                <li key={entry.key} className="text-xs text-muted">
                  <span className="text-text">テロップ</span> — {entry.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
