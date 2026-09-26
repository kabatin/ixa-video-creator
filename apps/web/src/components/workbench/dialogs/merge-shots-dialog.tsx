'use client'

import { planMerge } from '@ixa/domain'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { formatSpan } from '@/lib/format-time'
import { EMPTY_SELECTION } from '@/lib/shot-bulk'

/**
 * チェックした Shot の結合の確認（ADR-0024）。メニューと一括操作バーが開く。
 *
 * **先頭以外は消える。** 取り消しが無いので、何を残して何を消すかをここで言う。
 * 結合できない組み合わせ（飛び飛び・Take あり）は理由を出して押させない。
 */
export const MergeShotsDialogBody = () => {
  const workbench = useWorkbench()
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const checked = (workbench.shots ?? []).filter((shot) => workbench.checked.has(shot.id))
  const plan = planMerge(checked)

  const run = async (): Promise<void> => {
    if (!plan.ok) return
    setMerging(true)
    setError(null)
    try {
      await createApiClient().mergeShots(
        workbench.projectId,
        checked.map((shot) => shot.id),
      )
      workbench.setChecked(EMPTY_SELECTION)
      workbench.notify(`${String(checked.length)} 件の Shot を ${plan.keep.code} にまとめました。`)
      workbench.closeDialog()
      workbench.refresh()
    } catch (caught) {
      setError(`結合できませんでした: ${describeError(caught)}`)
    } finally {
      setMerging(false)
    }
  }

  return (
    <>
      {plan.ok ? (
        <p className="text-sm text-text">
          {`${String(checked.length)} 件の Shot を ${plan.keep.code}（${formatSpan(plan.keep.startSec, plan.durationSec)}）にまとめます。` +
            `${plan.keep.code} の説明・カメラ・登場人物を残し、${plan.remove.map((shot) => shot.code).join('、')} は削除します。元に戻せません。`}
        </p>
      ) : (
        <p role="alert" className="text-sm text-danger">
          {`結合できません: ${plan.reason}`}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" onClick={workbench.closeDialog} disabled={merging}>
          やめる
        </Button>
        <Button
          size="sm"
          tone="danger"
          disabled={merging || !plan.ok}
          onClick={() => {
            void run()
          }}
        >
          {merging ? '結合中…' : '結合する'}
        </Button>
      </div>
    </>
  )
}
