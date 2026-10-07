'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { describeRemakePlan } from '@/lib/remake-final-plan'
import type { RemakeFinalPreview } from '@/components/workbench/use-bulk-actions'

/**
 * 採用した試作を、まとめて本番の画質で作り直す（ADR-0042 段 4 / 資料 3.4「夜間の一括生成」）。
 *
 * **押す前に下見を出す。** 一晩かかる操作なので、本数と終わる時刻を見てから押させる。
 * 下見は開いたときに 1 回だけ引く（投入はしない）。
 * **飛ばす Shot は理由ごと並べる**（件数に畳まない。L-015）。
 */
export const BulkRemakeFinalForm = ({
  preview,
  busy,
  onPreview,
  onRemake,
}: {
  /** `null` はまだ引いていない（開いた直後）。 */
  readonly preview: RemakeFinalPreview | null
  readonly busy: boolean
  readonly onPreview: () => void
  readonly onRemake: () => void
}) => {
  /**
   * 開いたら下見を引く。選択を変えて開き直せば、また引き直す。
   *
   * **依存は空。** 開いたときの 1 回だけ引く。`onPreview` は描画のたびに作り直されるので、
   * 依存に入れると下見を引き続ける（API を押し続ける）。
   */
  useEffect(() => {
    onPreview()
  }, [])

  if (preview === null || preview.kind === 'loading') {
    return (
      <p role="status" className="text-xs text-muted">
        見込みを調べています…
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
      <p className="text-xs text-text">{describeRemakePlan(plan, new Date())}</p>
      <p className="text-xs text-muted">
        試作で決めた仕様のまま、同じシードで作り直します。試作の Take は残ります。
      </p>
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
      <Button size="sm" tone="primary" disabled={busy || plan.targetCount === 0} onClick={onRemake}>
        {`${String(plan.targetCount)} 本を積む`}
      </Button>
    </div>
  )
}
