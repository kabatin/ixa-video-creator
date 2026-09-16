import { ModelId, ProviderId } from '@ixa/domain'
import type { ImageModelCapabilities, ImageModelDescriptor } from '@ixa/provider-core'

/**
 * Codex CLI の組み込み `image_gen` を画像 Provider として扱う（ADR-0012）。
 * CLI は「もう 1 つの Provider 実装」であり、呼び出し側は HTTP か CLI かを知らない。
 *
 * **capability は調査結果ベースで、実機確認は済んでいない。**
 * 未確認の項目はここにコメントで残し、実装時（ADR-0012 の Follow-up）に実測で置き換える。
 */
export const CODEX_CLI_PROVIDER_ID: ProviderId = ProviderId.parse('codex-cli')

export const CODEX_CLI_IMAGE_MODEL_ID: ModelId = ModelId.parse('codex-cli/image-gen')

const CODEX_CLI_CAPABILITIES: ImageModelCapabilities = {
  referenceImages: {
    /**
     * **未確認**。`image_gen` が参照画像を受け付けることは分かっているが上限は不明。
     * 過少に宣言しておけば ReferenceResolver が切り詰めるだけで済み、実行時の失敗にならない。
     * 実測できたら直すこと。
     */
    max: 4,
    roles: ['subject', 'wardrobe', 'location', 'style', 'brand'],
  },
  /**
   * 1024x1024 のみ宣言する。
   * 横長・縦長（1536x1024 / 1024x1536）も出せるが、`AspectRatio` に 3:2 / 2:3 が無く
   * 対応するアスペクト比を宣言できない。四面図は正方形で足りるため Phase 2 では困らない。
   */
  resolutions: [{ width: 1024, height: 1024 }],
  aspectRatios: ['1:1'],
  /** マスク指定の編集（inpainting / 背景差し替え）に対応する（ARCHITECTURE.md §9 / ADR-0012）。 */
  maskEdit: true,
  /** **未確認**。`image_gen` に seed 指定の記述が無いため、無いものとして宣言する。 */
  seed: false,
  negativePrompt: false,
}

export const codexCliImageModel: ImageModelDescriptor = {
  id: CODEX_CLI_IMAGE_MODEL_ID,
  providerId: CODEX_CLI_PROVIDER_ID,
  label: 'Codex CLI (image_gen)',
  capabilities: CODEX_CLI_CAPABILITIES,
  qualities: {
    characterConsistency: 0.7,
    promptAdherence: 0.85,
    textRendering: 0.85,
  },
  economics: {
    /**
     * サブスク認証で動くため **1 回あたりのコストが取得できない**（ADR-0012）。
     * 0 として扱うと予算ガード（ARCHITECTURE.md §11）が効かない点に注意。
     * 高volume の自動ループでは HTTP アダプタを使うこと。
     */
    costPerImageUsd: 0,
    typicalLatencySec: 30,
  },
}

export const codexCliImageModels: readonly ImageModelDescriptor[] = [codexCliImageModel]
