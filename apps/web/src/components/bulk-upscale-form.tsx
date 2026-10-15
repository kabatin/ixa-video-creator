'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { describeUpscalePlan } from '@/lib/upscale-plan'
import type { UpscalePreview } from '@/components/workbench/use-bulk-actions'

/**
 * 採用中の Take を、まとめて解像度を上げる（ADR-0044 / 制作者 2026-10-16）。
 *
 * 「本番で作り直す」（`bulk-remake-final-form.tsx`）と同じく、**押す前に下見を出す**。
 * 上げたもの・上げている最中・採用していない Shot は理由ごと並べる（L-015）。
 */
export const BulkUpscaleForm = ({
  preview,
  busy,
  onPreview,
  onUpscale,
}: {
  /** `null` はまだ引いていない（開いた直後）。 */
  readonly preview: UpscalePreview | null
  readonly busy: boolean
  readonly onPreview: () => void
  readonly onUpscale: () => void
}) => {
  /** 開いたときの 1 回だけ引く（依存に `onPreview` を入れると引き続ける。作り直しのフォームと同じ）。 */
  useEffect(() => {
    onPreview()
  }, [])

  if (preview === null || preview.kind === 'loading') {
    return (
      <p role="status" className="text-xs text-muted">
        上げられる Take を調べています…
      </p>
    )
  }

  if (preview.kind === 'error') {
    return (
      <p role="status" className="text-xs text-danger">
        {preview.message}
      </p>
    )
  }

  const { plan } = preview
  return (
    <div className="space-y-2">
      <p className="text-xs text-text">{describeUpscalePlan(plan)}</p>
      <p className="text-xs text-muted">絵は変わりません。元の Take は残り、上げたものが隣に並びます。</p>
      {plan.skipped.length > 0 && (
        <div className="text-xs text-muted">
          <p>{`飛ばす ${String(plan.skipped.length)} 件:`}</p>
          <ul className="mt-1 space-y-0.5">
            {plan.skipped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <Button size="sm" tone="primary" disabled={busy || plan.targetCount === 0} onClick={onUpscale}>
        {`${String(plan.targetCount)} 本を上げる`}
      </Button>
    </div>
  )
}
