import { LookImageRole } from '@ixa/domain'
import type { Option } from '@/lib/identity-images'

/**
 * Look 画像の役割（docs/ARCHITECTURE.md §8）。
 * Look は時系列で変わる外見（衣装・髪・年齢）を持ち、ReferenceResolver では
 * role='wardrobe' として展開される。
 */

const ROLE_LABELS: Readonly<Record<LookImageRole, string>> = {
  wardrobe: '衣装',
  hair: '髪型',
  full_body: '全身',
  reference_still: '参考スチル',
}

export const lookRoleLabel = (role: LookImageRole): string => ROLE_LABELS[role]

export const LOOK_ROLE_OPTIONS: readonly Option[] = LookImageRole.options.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}))

export const DEFAULT_LOOK_ROLE: LookImageRole = LookImageRole.enum.wardrobe

export const CANONICAL_FRAME_NOTICE =
  '最初に承認された Take の 1 フレームを canonical frame に昇格させると、' +
  '以降の全 Shot がそのフレームを最優先の参照として使い、Look のドリフトが止まります。'

export const CANONICAL_FRAME_ABSENT_HINT =
  'canonical frame が未設定です。Shot ごとに参照が揺れ、外見がドリフトしやすくなります。'
