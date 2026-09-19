import type { ReactNode } from 'react'

/**
 * インスペクターの上端（UI-WORKBENCH-2 §5.1）。何を見ているか・状態・`⋯`。
 */
export const ObjectHeader = ({
  kind,
  title,
  meta,
  badge,
  menu,
}: {
  /** 種類の名前（「Shot」「キャラクター」…）。 */
  readonly kind: string
  readonly title: string
  readonly meta?: ReactNode
  readonly badge?: ReactNode
  readonly menu?: ReactNode
}) => (
  <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-2 py-1">
    <span className="shrink-0 whitespace-nowrap rounded bg-surface-2 px-1.5 text-xs text-muted">
      {kind}
    </span>
    <strong className="max-w-[60%] shrink-0 truncate text-sm text-text">{title}</strong>
    {meta !== undefined && (
      <span className="min-w-0 truncate text-xs tabular-nums text-muted">{meta}</span>
    )}
    <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap">
      {badge}
      {menu}
    </span>
  </div>
)
