import { MAX_TAKES_PER_REQUEST } from '@/lib/api-schemas'
import type { Option } from '@/lib/camera-options'

/**
 * 生成トリガの選択肢。
 * Phase 1 のモデル選択は AUTO 固定（ルーターに委ねる / docs/ARCHITECTURE.md §9）。
 */
export const AUTO_MODEL = 'AUTO'

export const MODEL_OPTIONS: readonly Option[] = [
  { value: AUTO_MODEL, label: 'AUTO（ルーターに任せる）' },
]

export const TAKE_COUNT_OPTIONS: readonly Option[] = Array.from(
  { length: MAX_TAKES_PER_REQUEST },
  (_unused, index) => {
    const count = index + 1
    return { value: String(count), label: `${String(count)} 本` }
  },
)
