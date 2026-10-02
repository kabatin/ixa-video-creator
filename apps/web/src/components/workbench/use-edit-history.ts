'use client'

import type { EditBatchId, ProjectId } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { formatEditBatchTime } from '@/lib/edit-history'
import type { WireEditBatch } from '@/lib/edit-history-api'
import { undoDisabledReason, type UndoAvailability } from '@/lib/menu-model'

/**
 * 戻す 1 件。**押す前に見せる材料**（見出し・件数・いつ）と、実行に要る id。
 *
 * ⌘Z が拾うのは「自分の直前の 1 手」ではなく**その Project の履歴の先頭**で、
 * 1 時間前の操作でも、別の人の操作でもありうる。だから `when` まで見せる。
 */
export type UndoTarget = {
  readonly id: EditBatchId
  readonly summary: string
  readonly shotCount: number
  /** いつの操作か（`formatEditBatchTime` の書式）。 */
  readonly when: string
}

/** 「元に戻す」の状態一式。確認を挟むため、開始・確定・取りやめを分けて持つ。 */
export type UndoState = {
  /** メニューの見た目（項目名・灰色とその理由）はこれだけで決まる。 */
  readonly availability: UndoAvailability
  /** 確認待ちの対象。`null` なら確認を出していない。**ここが埋まるまで API は呼ばない。** */
  readonly pending: UndoTarget | null
  /** 確認の「戻す」。実行して、通知に出す文を返す。 */
  readonly confirm: () => Promise<string>
  /** 確認の「やめる」。何も実行しない。 */
  readonly cancel: () => void
}

export type EditHistoryState = {
  /**
   * 「元に戻す」の状態一式。**boolean ではない。**
   *
   * 名前が `canUndo` のままなのは、`project-workbench.tsx` の配線
   * `canUndo={history.canUndo}` を変えずに済ませるため（別作業が同じファイルを触っている）。
   * `undo` への改名は配線ごと Architect が行う。
   */
  readonly canUndo: UndoState
  /**
   * ⌘Z の口。**押しただけでは戻さない。** 戻せるなら確認を開いて `null`（通知なし）を返し、
   * 戻せないならその理由の文を返す。
   */
  readonly undoLatest: () => Promise<string | null>
  readonly reload: () => void
}

/**
 * 履歴の読み込み。**「まだ読めていない」「読めなかった」「読めた」を混ぜない**（lessons L-015）。
 * 読めなかったときに空配列へ畳むと、通信不良が「もう戻せない」に化ける。
 */
type HistoryLoad =
  | { readonly state: 'loading' }
  | { readonly state: 'unreadable'; readonly reason: string }
  | { readonly state: 'loaded'; readonly batches: readonly WireEditBatch[] }

const LOADING: HistoryLoad = { state: 'loading' }

/** どの Project を読んだ結果か。別の Project の履歴を流用しない。 */
type Stored = { readonly projectId: ProjectId; readonly load: HistoryLoad }

/**
 * メニューへ渡す状態に、実行に要る id を足したもの。
 * **状態と対象を別々に持たない。**「戻せる」と言いながら対象が無い、を型で起こせなくする。
 */
type Undo =
  | Exclude<UndoAvailability, { readonly state: 'ready' }>
  | { readonly state: 'ready'; readonly target: UndoTarget }

/** 戻せる先頭の一括操作。**取り消せるかどうかの判定はサーバの `canUndo`**（L-016）。 */
const latestTargetOf = (batches: readonly WireEditBatch[]): UndoTarget | null => {
  const batch = batches.find((entry) => entry.canUndo)
  return batch === undefined
    ? null
    : {
        id: batch.id,
        summary: batch.summary,
        shotCount: batch.shotCount,
        when: formatEditBatchTime(batch.createdAt),
      }
}

/** 確認の文。**何が・いつ・何件戻るのかと、取り消せないことを必ず書く。** */
export const undoConfirmMessage = (target: UndoTarget): string =>
  `${target.when} の「${target.summary}」を元に戻します。` +
  `${target.shotCount.toString()} 件の Shot が変更前の内容に戻ります。この操作は取り消せません。`

/**
 * メニュー「元に戻す」（⌘Z）の口（UI-WORKBENCH §4）。**戻せるのは一括操作だけ。**
 * 1 打鍵ずつの編集は戻せない（`edit-history-panel` と同じ前提）。
 *
 * 広い範囲（複数 Shot）に及び、やり直しも無い操作なので、**実行前に必ず確認を挟む**
 * （UI-WORKBENCH-2 §8。確認の見た目は `WorkbenchMenu` が `WorkbenchDialog` で出す）。
 */
export const useEditHistory = (projectId: ProjectId, epoch: number): EditHistoryState => {
  const api = useMemo(() => createApiClient(), [])
  const [stored, setStored] = useState<Stored>({ projectId, load: LOADING })
  const [pending, setPending] = useState<UndoTarget | null>(null)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let cancelled = false
    api
      .listEditBatches(projectId)
      .then((batches) => {
        if (!cancelled) setStored({ projectId, load: { state: 'loaded', batches } })
      })
      .catch((cause: unknown) => {
        // 読めなかったことを値として残す。空配列に畳むと「戻せるものが無い」に化ける（L-015）。
        if (!cancelled) {
          setStored({ projectId, load: { state: 'unreadable', reason: describeForPerson(cause) } })
        }
      })
    return () => {
      cancelled = true
    }
  }, [api, projectId, epoch, reloads])

  const load = stored.projectId === projectId ? stored.load : LOADING

  /** 状態と対象を 1 か所から作る。別々に組み立てると「戻せるのに対象が無い」が起きる。 */
  const undo: Undo = useMemo<Undo>(() => {
    if (load.state === 'loading') return LOADING
    if (load.state === 'unreadable') return { state: 'unreadable', reason: load.reason }
    const target = latestTargetOf(load.batches)
    return target === null ? { state: 'none' } : { state: 'ready', target }
  }, [load])

  const confirm = useCallback(async (): Promise<string> => {
    if (pending === null) return '戻す対象がありません。もう一度お試しください。'
    const target = pending
    setPending(null)
    try {
      const result = await api.undoEditBatch(projectId, target.id)
      setReloads((count) => count + 1)
      const failed = result.failed.length + result.failedClips.length
      return failed === 0
        ? `「${target.summary}」を戻しました。`
        : `「${target.summary}」を戻しました（${String(failed)} 件は戻せませんでした。変更履歴で理由を確認できます）。`
    } catch (cause) {
      return `戻せませんでした: ${describeForPerson(cause)}`
    }
  }, [api, projectId, pending])

  const undoLatest = useCallback((): Promise<string | null> => {
    if (undo.state === 'ready') {
      setPending(undo.target)
      return Promise.resolve(null)
    }
    // 灰色の理由と同じ文を使う（言い方を二重に持たない。L-016）。
    // `ready` 以外なら理由は必ずある。`null` になるのは型の上だけ。
    const reason = undoDisabledReason(undo)
    return Promise.resolve(reason === null ? null : `${reason}。`)
  }, [undo])

  return {
    canUndo: {
      availability: undo,
      pending,
      confirm,
      cancel: () => {
        setPending(null)
      },
    },
    undoLatest,
    reload: () => {
      setReloads((count) => count + 1)
    },
  }
}
