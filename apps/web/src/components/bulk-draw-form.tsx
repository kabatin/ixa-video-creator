'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useContextMenuHost } from '@/components/workbench/ui/context-menu'
import { DRAW_ANYWAY_LABEL } from '@/lib/step-guards'

/**
 * 絵コンテの画像をまとめて作る（ADR-0029）。**既定は絵の無い Shot だけ。** 作り直しは選んだときだけ
 * （手で付けた絵を黙って置き換えない）。Codex は 1 枚 1 分ほどなので、かかる時間の目安を先に言う。
 * 絵コンテ（説明）が空の Shot が混じっていたら、作る前に確かめる（制作者 2026-10-03「警告ダイアログを出して、任意の上で実行」）。
 */
export const BulkDrawForm = ({
  idPrefix,
  targetCount,
  busy,
  onDraw,
  warning,
}: {
  readonly idPrefix: string
  readonly targetCount: number
  readonly busy: boolean
  readonly onDraw: (input: { readonly onlyMissing: boolean }) => void
  /** 絵コンテが空の Shot が混じっているときの確認の文。無ければ null。 */
  readonly warning: string | null
}) => {
  const [redraw, setRedraw] = useState(false)
  const host = useContextMenuHost()
  const draw = (): void => {
    const input = { onlyMissing: !redraw }
    if (warning === null) {
      onDraw(input)
      return
    }
    host.perform({
      kind: 'item',
      id: 'bulk-draw',
      label: '絵コンテの画像を作る',
      disabledReason: null,
      confirm: warning,
      confirmTone: 'primary',
      confirmLabel: DRAW_ANYWAY_LABEL,
      run: () => {
        onDraw(input)
      },
    })
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-text">
        {`チェックした ${String(targetCount)} 件の絵コンテの画像（最初のフレーム）を AI で作ります。1 枚 1 分ほどかかり、順番に作ります。`}
      </p>
      <label htmlFor={`${idPrefix}-redraw`} className="flex items-center gap-2 text-xs text-text">
        <input
          id={`${idPrefix}-redraw`}
          type="checkbox"
          checked={redraw}
          disabled={busy}
          onChange={(event) => {
            setRedraw(event.target.checked)
          }}
        />
        絵がある Shot も作り直す（前の絵は置き換わる）
      </label>
      <Button size="sm" tone="primary" disabled={busy || targetCount === 0} onClick={draw}>
        作る
      </Button>
    </div>
  )
}
