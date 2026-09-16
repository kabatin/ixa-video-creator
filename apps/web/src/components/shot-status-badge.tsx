import type { ShotStatus } from '@ixa/domain'
import { shotStatusClassName, shotStatusLabel } from '@/lib/shot-display'

export type ShotStatusBadgeProps = {
  readonly status: ShotStatus
}

/** 状態は色で区別する。色だけに頼らずラベルも必ず出す。 */
export const ShotStatusBadge = ({ status }: ShotStatusBadgeProps) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${shotStatusClassName(status)}`}
  >
    {shotStatusLabel(status)}
  </span>
)
