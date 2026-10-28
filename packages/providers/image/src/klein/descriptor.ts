import { ModelId, ProviderId, type Resolution } from '@ixa/domain'
import type { ImageModelCapabilities, ImageModelDescriptor } from '@ixa/provider-core'
import type { LocalServerIdentity } from '@ixa/provider-video'

/**
 * 手元の生成サーバ klein-api 経由の **FLUX.2 [klein]**（ADR-0047）。
 *
 * 契約の正は klein-api の `docs/api.md` と `GET /v1/capabilities`。**送るのは段（draft / standard）だけ**で、
 * モデルのファイル・step・CFG・量子化はサーバが決める（wan と同じ。ADR-0040 §4）。
 *
 * 実測（新Mac・M5 10 コア GPU・32GB。2026-10-16）: 9B・1024×1024・4 step で 1 枚 25.9 秒（毎回起動）。
 * seed を固定すると同じ絵が出る。参照画像は FLUX.2 の参照として効く（2 枚まで実測）。
 */
export const KLEIN_PROVIDER_ID: ProviderId = ProviderId.parse('klein')

export const KLEIN_IMAGE_MODEL_ID: ModelId = ModelId.parse('klein/flux2-klein')
/** 同じ workflow の速い段（draft = klein 4B。ADR-0065）。 */
export const KLEIN_4B_IMAGE_MODEL_ID: ModelId = ModelId.parse('klein/flux2-klein-4b')
/** klein-api の別の workflow（Z Image Turbo。ADR-0065）。 */
export const Z_IMAGE_TURBO_MODEL_ID: ModelId = ModelId.parse('klein/z-image-turbo')

/** klein-api 側のワークフロー名。 */
export const KLEIN_WORKFLOW_ID = 'flux2-klein'
export const Z_IMAGE_TURBO_WORKFLOW_ID = 'z-image-turbo'

/** klein-api の既定の待ち受け（vpipe-api は 8765、wan-api は 8766）。 */
export const KLEIN_DEFAULT_BASE_URL = 'http://127.0.0.1:8767'

export const KLEIN_IDENTITY: LocalServerIdentity = Object.freeze({
  providerId: KLEIN_PROVIDER_ID,
  label: 'ローカルの画像生成（klein）',
  codePrefix: 'klein',
  workflowId: KLEIN_WORKFLOW_ID,
  serverName: 'klein-api',
  startHint: '起動していません（klein-api を起動してください）',
  urlEnvName: 'KLEIN_API_URL',
  tokenEnvName: 'KLEIN_API_TOKEN',
})

/**
 * 作る形。向きごとに 1 つ（Codex と同じ扱い。比への切り抜きは worker）。
 * どれも約 1MP・64 の倍数で、**サーバがそのまま作れる大きさ**（切り抜きも拡大もしない）。
 */
const LANDSCAPE: Resolution = { width: 1344, height: 768 }
const PORTRAIT: Resolution = { width: 768, height: 1344 }
const SQUARE: Resolution = { width: 1024, height: 1024 }

const KLEIN_CAPABILITIES: ImageModelCapabilities = {
  referenceImages: {
    /**
     * **2 枚まで**（新Mac で実測。2026-10-16）。`--image` は FLUX.2 の参照として効き、人物の顔・服が保たれる。
     * 1 枚で約 2 倍（50 秒）、2 枚で約 2.8 倍（73 秒）かかる。3〜4 枚は未実測なので宣言しない
     * （上限を超えた分は ReferenceResolver が優先順に切り詰める）。klein-api の既定も 2。
     */
    max: 2,
    roles: ['subject', 'wardrobe', 'location', 'style', 'brand'],
  },
  resolutions: [LANDSCAPE, PORTRAIT, SQUARE],
  aspectRatios: ['16:9', '21:9', '9:16', '4:5', '1:1'],
  maskEdit: false,
  seed: true,
  /** CFG=1 の蒸留モデルでは効かない。klein-api も受けない（422）。 */
  negativePrompt: false,
}

export const kleinImageModel: ImageModelDescriptor = {
  id: KLEIN_IMAGE_MODEL_ID,
  providerId: KLEIN_PROVIDER_ID,
  label: 'FLUX.2 [klein] 9B（手元）',
  capabilities: KLEIN_CAPABILITIES,
  /** 画像は「使う AI」で明示して選ぶので Router は使わない。値は目安。 */
  qualities: {
    characterConsistency: 0.6,
    promptAdherence: 0.8,
    textRendering: 0.6,
  },
  economics: {
    /** 手元の GPU。費用は掛からない。 */
    costPerImageUsd: 0,
    /** 実測: 参照なし 26〜35 秒、参照 1 枚 50 秒、2 枚 73 秒（9B）。最初のフレームは人物の参照が付くことが多い。 */
    typicalLatencySec: 50,
  },
}

/**
 * klein 4B（klein-api の `quality: draft`。ADR-0065）。9B と同じ workflow・同じ大きさ・同じ参照の扱いで、
 * 段だけが違う（サーバが 4B のモデルを使う）。Apache-2.0。実測: 1 枚 14 秒・約 5GB（参照なし）。
 */
export const klein4bImageModel: ImageModelDescriptor = {
  ...kleinImageModel,
  id: KLEIN_4B_IMAGE_MODEL_ID,
  label: 'FLUX.2 [klein] 4B（手元）',
  qualities: { characterConsistency: 0.5, promptAdherence: 0.7, textRendering: 0.5 },
  economics: { costPerImageUsd: 0, typicalLatencySec: 25 },
}

/**
 * Z Image Turbo（klein-api の `z-image-turbo` workflow。ADR-0065）。Apache-2.0。1 枚 約 33 秒。
 * 本文は flux2-klein と同じ形。**参照の画像は受けない**（文章から作るモデル。人物の見た目は文章で伝える）。
 * 大きさは 64 の倍数（ここの 3 つはどれも 64 の倍数）。
 */
export const zImageTurboModel: ImageModelDescriptor = {
  ...kleinImageModel,
  id: Z_IMAGE_TURBO_MODEL_ID,
  label: 'Z Image Turbo（手元）',
  capabilities: { ...KLEIN_CAPABILITIES, referenceImages: { max: 0, roles: [] } },
  qualities: { characterConsistency: 0.3, promptAdherence: 0.8, textRendering: 0.7 },
  economics: { costPerImageUsd: 0, typicalLatencySec: 33 },
}

/** klein-api が出すモデル。worker はこの全部を klein の口に登録する。 */
export const KLEIN_IMAGE_MODELS: readonly ImageModelDescriptor[] = Object.freeze([kleinImageModel, klein4bImageModel, zImageTurboModel])

/** 送る workflow と段。 */
export type KleinVariant = { readonly workflow: string; readonly quality: 'draft' | 'standard' }

const VARIANTS: ReadonlyMap<string, KleinVariant> = new Map([
  [KLEIN_IMAGE_MODEL_ID, { workflow: KLEIN_WORKFLOW_ID, quality: 'standard' }],
  [KLEIN_4B_IMAGE_MODEL_ID, { workflow: KLEIN_WORKFLOW_ID, quality: 'draft' }],
  [Z_IMAGE_TURBO_MODEL_ID, { workflow: Z_IMAGE_TURBO_WORKFLOW_ID, quality: 'standard' }],
])

/** モデルの workflow と段。klein-api のモデルでなければ null。 */
export const kleinVariantOf = (modelId: ModelId): KleinVariant | null => VARIANTS.get(modelId) ?? null

/** klein-api の health で見る workflow の画面の名前。 */
export const kleinWorkflowLabelOf = (workflowId: string): string | undefined =>
  workflowId === KLEIN_WORKFLOW_ID ? 'FLUX.2 [klein]（手元）' : workflowId === Z_IMAGE_TURBO_WORKFLOW_ID ? zImageTurboModel.label : undefined
