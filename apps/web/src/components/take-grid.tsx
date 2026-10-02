'use client'

import type { Take, TakeId } from '@ixa/domain'
import { TakeCard } from '@/components/take-card'
import type { ContextMenuTriggerProps } from '@/components/workbench/use-context-menu'
import type { ContextMenuItem } from '@/components/workbench/ui/context-menu'

export type TakeGridProps = {
  readonly takes: readonly Take[]
  readonly selectedTakeId: TakeId | null
  readonly busy: boolean
  readonly onSelect: (takeId: TakeId) => void
  /** 右クリック・長押し・Shift+F10 でその Take のメニューを開く口。 */
  readonly takeContextMenu?: (take: Take) => ContextMenuTriggerProps
  /** カードの「…」で開くメニューの行（右クリックと同じ中身）。 */
  readonly takeMenuItems?: (take: Take) => readonly ContextMenuItem[]
}

/** Take は横並びで比較する。縦積みにすると隣の Take と見比べられない。 */
export const TakeGrid = ({
  takes,
  selectedTakeId,
  busy,
  onSelect,
  takeContextMenu,
  takeMenuItems,
}: TakeGridProps) => {
  if (takes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-muted">
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
          {...(takeContextMenu === undefined ? {} : { contextMenu: takeContextMenu(take) })}
          {...(takeMenuItems === undefined ? {} : { menuItems: () => takeMenuItems(take) })}
        />
      ))}
    </ul>
  )
}
