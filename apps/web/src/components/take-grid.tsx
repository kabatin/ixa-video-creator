'use client'

import type { Take, TakeId } from '@ixa/domain'
import { TakeCard } from '@/components/take-card'

export type TakeGridProps = {
  readonly takes: readonly Take[]
  readonly selectedTakeId: TakeId | null
  readonly busy: boolean
  readonly onSelect: (takeId: TakeId) => void
}

/** Take は横並びで比較する。縦積みにすると隣の Take と見比べられない。 */
export const TakeGrid = ({ takes, selectedTakeId, busy, onSelect }: TakeGridProps) => {
  if (takes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        Take がまだありません。生成を実行してください。
      </p>
    )
  }

  return (
    <ul className="flex gap-4 overflow-x-auto pb-2">
      {takes.map((take) => (
        <TakeCard
          key={take.id}
          take={take}
          selected={take.id === selectedTakeId}
          busy={busy}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}
