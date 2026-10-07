import { MAX_TAKES_PER_REQUEST } from '@/lib/api-schemas'
import type { Option } from '@/lib/camera-options'
import { finalTierModelOf } from '@ixa/domain'
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

/**
 * その Take を「本番で作り直す」ときに使うモデル（ADR-0042）。
 *
 * **選び方は domain が持つ**（`finalTierModelOf`）。まとめて積む経路（API）と同じ規則を通す。
 * モデル ID を画面に書き写さない（一覧は `GET /models` が唯一の正）。
 * 見つからなければ null（＝その場に本番の段が無いので、操作を出さない）。
 */
export const finalModelFor = (
  models: readonly WireVideoModel[] | null,
  takeModelId: string,
): WireVideoModel | null => finalTierModelOf(models ?? [], takeModelId)
