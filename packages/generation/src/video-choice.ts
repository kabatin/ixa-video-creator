import type { ProviderId } from '@ixa/domain'
import {
  SpecCompilationError,
  type GenerationModel,
  type ModelCatalogPort,
} from './build-generation.js'

/** AUTO を絞るのに要る、モデルの出どころと「AUTO に選ばせるか」の印。`VideoModelDescriptor` が満たす。 */
export type ChoosableVideoModel = GenerationModel & {
  readonly providerId: ProviderId
  readonly routable?: boolean
}

/**
 * AUTO の候補を「使う AI」で選んだ動画の AI のモデルだけにする（ADR-0032）。
 *
 * **.env で fal を有効にしていても、無料の AI を選んだ人の AUTO（一括生成の既定）が fal を選ばない。**
 * 人が選んだ AI なので、ふだん AUTO に出さない印（`routable: false`。手元の 1 本ずつのサーバ・静止画を動かす）
 * でも候補にする。明示したモデル（`findModel`）はそのまま引ける。
 */
export const catalogForVideoChoice = <M extends ChoosableVideoModel>(
  catalog: ModelCatalogPort<M>,
  providerId: ProviderId,
): ModelCatalogPort<M> => ({
  allModels: () => {
    const chosen = catalog.allModels().filter((model) => model.providerId === providerId)
    if (chosen.length === 0) {
      throw new SpecCompilationError(
        `選んだ動画の AI（${providerId}）はこの環境で有効になっていません。「使う AI」で選び直してください`,
      )
    }
    return chosen.map((model) => ({ ...model, routable: true }))
  },
  findModel: (modelId) => catalog.findModel(modelId),
})
