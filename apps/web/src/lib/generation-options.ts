import { MAX_TAKES_PER_REQUEST } from '@/lib/api-schemas'
import type { Option } from '@/lib/camera-options'
import type { WireVideoModel } from '@/lib/models-api'

/**
 * 生成トリガの選択肢。既定は AUTO（ルーターに委ねる / docs/ARCHITECTURE.md §9）。
 * 登録されているモデルも選べる（ADR-0025）。一覧は `GET /models` が唯一の正。
 */
export const AUTO_MODEL = 'AUTO'

const AUTO_OPTION: Option = { value: AUTO_MODEL, label: 'AUTO（ルーターに任せる）' }

export const MODEL_OPTIONS: readonly Option[] = [AUTO_OPTION]

/** AUTO を先頭に、登録されているモデルを並べる。一覧が読めていなければ AUTO だけ。 */
export const modelOptionsFrom = (models: readonly WireVideoModel[] | null): readonly Option[] => [
  AUTO_OPTION,
  ...(models ?? []).map((model) => ({ value: model.id, label: model.label })),
]

/**
 * 押す前に分かる「生成できない理由」。押せるなら null。
 * 最初のフレームが要るモデルで画像が無いと、押しても API が断るだけになる。
 */
export const generateBlocker = (
  model: WireVideoModel | null,
  hasStartFrame: boolean,
): string | null =>
  model?.requiresStartFrame === true && !hasStartFrame
    ? 'このモデルは最初のフレーム（画像）から動画を作ります。「参照」の「最初のフレーム」に画像を付けてください。'
    : null

export const TAKE_COUNT_OPTIONS: readonly Option[] = Array.from(
  { length: MAX_TAKES_PER_REQUEST },
  (_unused, index) => {
    const count = index + 1
    return { value: String(count), label: `${String(count)} 本` }
  },
)
