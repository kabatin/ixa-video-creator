import { ModelId, ProviderId } from '@ixa/domain'
import type { ImageModelCapabilities, ImageModelDescriptor } from '@ixa/provider-core'

/**
 * ローカルのスタブ画像 Provider（ADR-0014 の方針を画像へ広げたもの）。
 * 一時的なモックではなく恒久的に維持する一級の実装であり、
 * **あえて実モデルに似た制約を宣言する**。制約の緩いスタブだと、
 * 参照の切り詰め（ARCHITECTURE.md §8）が本番切替時に初めて走ることになるため。
 */
export const STUB_IMAGE_PROVIDER_ID: ProviderId = ProviderId.parse('stub-image')

export const STUB_GEMINI_LIKE_MODEL_ID: ModelId = ModelId.parse('stub/gemini-like-image')

/**
 * Gemini 3.1 Flash Image を模す。
 * - 参照画像 **14 枚**。四面図を使わずとも人物を確定できる枚数（§8 のキーフレーム方式の前提）
 * - **maskEdit なし**。マスク指定の編集は OpenAI 側の機能（ARCHITECTURE.md §9）
 * - seed あり / negative prompt なし
 */
const GEMINI_LIKE_CAPABILITIES: ImageModelCapabilities = {
  referenceImages: {
    max: 14,
    roles: ['subject', 'wardrobe', 'location', 'style', 'brand'],
  },
  resolutions: [
    { width: 1024, height: 1024 },
    { width: 1280, height: 720 },
    { width: 720, height: 1280 },
    { width: 1920, height: 1080 },
  ],
  aspectRatios: ['1:1', '16:9', '9:16'],
  maskEdit: false,
  seed: true,
  negativePrompt: false,
}

export const stubGeminiLikeImageModel: ImageModelDescriptor = {
  id: STUB_GEMINI_LIKE_MODEL_ID,
  providerId: STUB_IMAGE_PROVIDER_ID,
  label: 'Stub (Gemini-like image)',
  capabilities: GEMINI_LIKE_CAPABILITIES,
  qualities: {
    characterConsistency: 0.85,
    promptAdherence: 0.8,
    textRendering: 0.6,
  },
  economics: { costPerImageUsd: 0, typicalLatencySec: 3 },
}

export const stubImageModels: readonly ImageModelDescriptor[] = [stubGeminiLikeImageModel]
