'use client'

import type { ProjectId } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import type { WireEditBatch } from '@/lib/edit-history-api'

export type EditHistoryState = {
  /** 取り消せる一括操作があるか。判定はサーバの `canUndo`（L-016）。 */
  readonly canUndo: boolean
  /** 直近の取り消せる操作を戻す。結果の文を返す。 */
  readonly undoLatest: () => Promise<string>
  readonly reload: () => void
}

/**
 * メニュー「元に戻す」（⌘Z）の口（UI-WORKBENCH §4）。**戻せるのは一括操作だけ。**
 * 1 打鍵ずつの編集は戻せない（`edit-history-panel` と同じ前提）。
 */
export const useEditHistory = (projectId: ProjectId, epoch: number): EditHistoryState => {
  const api = useMemo(() => createApiClient(), [])
  const [batches, setBatches] = useState<readonly WireEditBatch[]>([])
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let cancelled = false
    api
      .listEditBatches(projectId)
      .then((next) => {
        if (!cancelled) setBatches(next)
      })
      .catch(() => {
        // 読めなければ「戻せるものが無い」と同じ見た目（押せない）。履歴の画面で理由が出る。
        if (!cancelled) setBatches([])
      })
    return () => {
      cancelled = true
    }
  }, [api, projectId, epoch, reloads])

  const latest = batches.find((batch) => batch.canUndo) ?? null

  const undoLatest = useCallback(async (): Promise<string> => {
    if (latest === null) return '戻せる一括操作がありません。'
    try {
      const result = await api.undoEditBatch(projectId, latest.id)
      setReloads((count) => count + 1)
      const failed = result.failed.length
      return failed === 0
        ? `「${latest.summary}」を戻しました。`
        : `「${latest.summary}」を戻しました（${String(failed)} 件は戻せませんでした。変更履歴で理由を確認できます）。`
    } catch (cause) {
      return `戻せませんでした: ${describeError(cause)}`
    }
  }, [api, projectId, latest])

  return {
    canUndo: latest !== null,
    undoLatest,
    reload: () => {
      setReloads((count) => count + 1)
    },
  }
}
