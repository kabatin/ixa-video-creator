'use client'

import { useContextMenuHost, type ContextMenuItem } from '@/components/workbench/ui/context-menu'

export type MoreMenuItem = {
  readonly label: string
  readonly run: () => Promise<void> | void
  /** 取り消せない操作。確認の文を渡すと、押したあとに確認を挟む。 */
  readonly confirm?: string
  /** 押せない理由。押せるなら省く。 */
  readonly disabledReason?: string
}

/**
 * `⋯` メニュー（UI-WORKBENCH-2 §8）。**取り消せない操作は入力欄の横に置かず、ここに入れる。**
 *
 * 開くのは右クリックのメニューと同じ部品（2026-09-30）。キーボードの操作・押せない理由・確認の出し方が
 * どこから開いても同じになる。確認はワークベンチのダイアログの殻で出す（`window.confirm` を使わない）。
 */
export const MoreMenu = ({
  label,
  items,
}: {
  /** 読み上げ用の名前（「CUT-04 のその他の操作」など）。 */
  readonly label: string
  readonly items: readonly MoreMenuItem[]
}) => (
  <MenuButton
    label={label}
    items={items.map((entry, index) => ({
      kind: 'item',
      id: `${String(index)}:${entry.label}`,
      label: entry.label,
      disabledReason: entry.disabledReason ?? null,
      run: entry.run,
      ...(entry.confirm === undefined ? {} : { confirm: entry.confirm }),
    }))}
  />
)

/** `⋯` を押すと、渡した行（右クリックのメニューと同じ中身）を開く。 */
export const MenuButton = ({
  label,
  items,
}: {
  readonly label: string
  /** 関数なら押した瞬間に作る（再生位置のように、開くときの値で決まる行があるとき）。 */
  readonly items: readonly ContextMenuItem[] | (() => readonly ContextMenuItem[])
}) => {
  const host = useContextMenuHost()
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        host.open({
          label,
          items: typeof items === 'function' ? items() : items,
          at: { x: box.left, y: box.bottom },
          origin: event.currentTarget,
        })
      }}
      className="inline-flex h-6 min-w-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-text"
    >
      ⋯
    </button>
  )
}
