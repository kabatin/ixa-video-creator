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
 * seed を固定すると同じ絵が出る。**参照画像が FLUX.2 の参照として効くかは未確認。**
 */
export const KLEIN_PROVIDER_ID: ProviderId = ProviderId.parse('klein')

export const KLEIN_IMAGE_MODEL_ID: ModelId = ModelId.parse('klein/flux2-klein')

/** klein-api 側のワークフロー名。 */
export const KLEIN_WORKFLOW_ID = 'flux2-klein'

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
     * **0 にしてある。** `--image` が FLUX.2 の参照として効くか（img2img の下絵になるだけか）が未確認で、
     * klein-api も確かめるまで受けない（`max_reference_images` の既定 0。送ると 422）。
     * 0 なら ReferenceResolver が参照を渡さないので、失敗にはならず指示文だけで作る。
     * 新Mac の実測で効くと分かったら、サーバの設定と一緒に上げる。
     */
    max: 0,
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
  label: 'FLUX.2 [klein]（手元）',
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
    /** 実測 25.9 秒（9B・1024×1024）。 */
    typicalLatencySec: 30,
  },
}
