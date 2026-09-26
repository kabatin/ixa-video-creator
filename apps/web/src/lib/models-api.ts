import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 登録されている映像モデルの呼び出し口。
 *
 * ```
 * GET /models   registry にいるモデルと、その性質
 * ```
 *
 * **画面がモデルの性質を書き写さない。** fps や参照の上限を画面側に写すと、
 * モデルを足したり載せ替えたりしたときに必ずズレる（`formatDuration` が 2 つあって
 * 規則が正反対だったのと同じ型の事故）。宣言が唯一の正。
 */

export const WireVideoModel = z.object({
  id: z.string(),
  providerId: z.string(),
  label: z.string(),
  /** このモデルが出す素材の fps。Project の fps を決める根拠にする。 */
  fps: z.array(z.number().positive()),
  resolutions: z.array(z.object({ width: z.number().int(), height: z.number().int() })),
  aspectRatios: z.array(z.string()),
  durations: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('enum'), values: z.array(z.number().positive()) }),
    z.object({
      mode: z.literal('range'),
      min: z.number().positive(),
      max: z.number().positive(),
      step: z.number().positive().optional(),
    }),
  ]),
  maxReferenceImages: z.number().int().nonnegative(),
  costPerSecondUsd: z.number().nonnegative(),
  audioGeneration: z.boolean(),
  /** 最初のフレーム（画像）が無ければ使えない（ADR-0025）。 */
  requiresStartFrame: z.boolean(),
  /** AUTO の候補になるか。false は明示して選ぶモデル。 */
  routable: z.boolean(),
})
export type WireVideoModel = z.infer<typeof WireVideoModel>

export type ModelsApi = {
  readonly listModels: () => Promise<readonly WireVideoModel[]>
}

export const createModelsApi = (requester: Requester): ModelsApi => ({
  listModels: () => requester.get('/models', z.array(WireVideoModel)),
})

/**
 * そのモデルに合わせるなら何 fps か。**選べる fps の中で一番小さいものを採る。**
 *
 * 素材が 24fps なのに Project を 30fps にすると、書き出しで 24→30 に引き伸ばされる
 * （`render/ffmpeg-filters.ts` が毎クリップに `fps=doc.fps` を掛ける）。
 * 無い絵を作ることになるので、素材に合わせておくほうが動きがきれい。
 *
 * 選べる fps が無い宣言は想定しない（`VideoModelCapabilities` が 1 つ以上を要求する）。
 */
export const recommendedFps = (model: WireVideoModel): number | null => {
  const sorted = [...model.fps].sort((a, b) => a - b)
  return sorted[0] ?? null
}
