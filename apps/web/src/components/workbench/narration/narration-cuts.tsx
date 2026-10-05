'use client'

import { useMemo, useState } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { narrationCutBoundaries } from '@/lib/cut-marks'
import { formatClock } from '@/lib/format-time'

export type PlacedLine = { readonly startSec: number; readonly durationSec: number }

/**
 * 曲の無い作品を、ナレーションの切れ目で区切って Shot にする（ADR-0038）。
 * 曲が無いと波形の上で区切れないので、置いた行の話し始めを区切りにする（聴くのはプレビューで）。
 * 既にある Shot と重なる区間は API が飛ばす（2 度押しても同じ区間に Shot は増えない）。
 */
export const NarrationCuts = ({ placed }: { readonly placed: readonly PlacedLine[] }) => {
  const workbench = useWorkbench()
  const api = useMemo(() => createApiClient(), [])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ readonly text: string; readonly danger: boolean } | null>(null)
  const boundaries = narrationCutBoundaries(placed)
  const count = Math.max(boundaries.length - 1, 0)
  const end = boundaries[boundaries.length - 1] ?? 0

  const create = (): void => {
    setBusy(true)
    setMessage(null)
    api
      .createCuts(workbench.projectId, { boundariesSec: boundaries, sequenceId: null })
      .then((result) => {
        setMessage({ text: `${String(result.createdCount)} 個の Shot を作りました。`, danger: false })
        workbench.refresh()
      })
      .catch((cause: unknown) => {
        setMessage({ text: `Shot にできませんでした: ${describeForPerson(cause)}`, danger: true })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <section aria-label="ナレーションの切れ目で区切る" className="m-2 space-y-2 rounded border border-line p-3 text-sm">
      <p className="text-text">曲の無い作品は、ナレーションの行の切れ目で区切って Shot にできます。</p>
      <p className="text-xs text-muted">
        {`0:00.00 から ${formatClock(end)} まで、${String(count)} カット（行の話し始めで区切り、行の間の無音は前のカットに入れます）。聴いて確かめるのはプレビューで。`}
      </p>
      <Button tone="primary" size="sm" disabled={busy || count === 0} onClick={create}>
        {busy ? '作成中…' : `ナレーションの切れ目で ${String(count)} カットを Shot にする`}
      </Button>
      {message !== null && (
        <p role={message.danger ? 'alert' : 'status'} className={`text-xs ${message.danger ? 'text-danger' : 'text-muted'}`}>
          {message.text}
        </p>
      )}
    </section>
  )
}
