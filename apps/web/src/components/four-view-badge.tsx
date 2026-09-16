import { FOUR_VIEW_ABSENT_HINT, identityRoleHint, FOUR_VIEW_ROLE } from '@/lib/identity-images'

export type FourViewBadgeProps = {
  readonly present: boolean
}

/**
 * 四面図の有無。参照枠が 3 枚しかないモデルでは有無がそのまま品質差になるため、
 * 「未登録」を目立つ形で出して登録を促す（docs/ARCHITECTURE.md §8）。
 */
export const FourViewBadge = ({ present }: FourViewBadgeProps) =>
  present ? (
    <span
      title={identityRoleHint(FOUR_VIEW_ROLE)}
      className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800"
    >
      四面図あり
    </span>
  ) : (
    <span
      title={FOUR_VIEW_ABSENT_HINT}
      className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900"
    >
      四面図なし
    </span>
  )
