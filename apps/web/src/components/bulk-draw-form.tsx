'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * 絵コンテの画像をまとめて作る（ADR-0029）。**既定は絵の無い Shot だけ。** 作り直しは選んだときだけ
 * （手で付けた絵を黙って置き換えない）。Codex は 1 枚 1 分ほどなので、かかる時間の目安を先に言う。
 */
export const BulkDrawForm = ({
  idPrefix,
  targetCount,
  busy,
  onDraw,
}: {
  readonly idPrefix: string
  readonly targetCount: number
  readonly busy: boolean
  readonly onDraw: (input: { readonly onlyMissing: boolean }) => void
}) => {
  const [redraw, setRedraw] = useState(false)
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
      <Button size="sm" tone="primary" disabled={busy || targetCount === 0} onClick={() => onDraw({ onlyMissing: !redraw })}>
        作る
      </Button>
    </div>
  )
}
