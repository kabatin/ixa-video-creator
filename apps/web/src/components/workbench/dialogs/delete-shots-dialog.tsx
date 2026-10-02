'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { describeDeleteTargets, summarizeDeleteResults } from '@/lib/delete-shots'
import { resolveShotTargets } from '@/lib/shot-targets'
import { EMPTY_SELECTION } from '@/lib/shot-bulk'

/**
 * Shot の削除の確認（制作者の要望 2026-09-26）。メニュー・Delete キー・一括操作バーが開く。
 *
 * 対象は `resolveShotTargets` が決める（チェックがあればチェックした Shot、無ければ
 * 選んでいる Shot）。**取り消しは無い**ので、何を消すかをここで必ず言う。
 */
export const DeleteShotsDialogBody = () => {
  const workbench = useWorkbench()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const targets = resolveShotTargets(
    workbench.shots ?? [],
    workbench.checked,
    workbench.selectedShotId,
    workbench.dialogShotIds,
  )

  const run = async (): Promise<void> => {
    setDeleting(true)
    setError(null)
    try {
      const result = await createApiClient().bulkDeleteShots(
        workbench.projectId,
        targets.map((shot) => shot.id),
      )
      workbench.setChecked(EMPTY_SELECTION)
      workbench.notify(summarizeDeleteResults(targets, result.results))
      workbench.closeDialog()
      workbench.refresh()
    } catch (caught) {
      // 閉じない。何も消えていないかもしれないので、理由を見せてやり直せるようにする。
      setError(`削除できませんでした: ${describeError(caught)}`)
    } finally {
      setDeleting(false)
    }
  }

  if (targets.length === 0) {
    return <p className="text-sm text-muted">削除する Shot がありません。Shot を選ぶかチェックしてください。</p>
  }

  return (
    <>
      <p className="text-sm text-text">{describeDeleteTargets(targets)}</p>
      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" onClick={workbench.closeDialog} disabled={deleting}>
          やめる
        </Button>
        <Button
          size="sm"
          tone="danger"
          disabled={deleting}
          onClick={() => {
            void run()
          }}
        >
          {deleting ? '削除中…' : '削除する'}
        </Button>
      </div>
    </>
  )
}
