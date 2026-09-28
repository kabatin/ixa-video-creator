import type {
  AspectRatio,
  MediaAssetId,
  ModelId,
  ProviderId,
  ReferenceRole,
  Resolution,
} from '@ixa/domain'
import type { ProviderJobHandle, ProviderOutput } from './provider.js'

/**
 * 画像モデルの能力宣言。`VideoModelCapabilities` の画像版であり、役割も同じ
 * （不可能な要求を Provider へ投げる前に弾くための根拠）。
 *
 * 実 API と乖離しうるため、各アダプタに契約テストを置いて検知すること。
 */
export type ImageModelCapabilities = {
  readonly referenceImages: { readonly max: number; readonly roles: readonly ReferenceRole[] }
  readonly resolutions: readonly Resolution[]
  readonly aspectRatios: readonly AspectRatio[]
  /** マスク指定の編集に対応するか。Gemini は非対応、OpenAI は対応（ARCHITECTURE.md §9）。 */
  readonly maskEdit: boolean
  readonly seed: boolean
  readonly negativePrompt: boolean
}

/**
 * Model Router のスコアリングに使う評価値（0..1）。
 * 画像では動きより **文字が破綻しないか**（textRendering）が効くため、動画とは項目が違う。
 */
export type ImageModelQualities = {
  readonly characterConsistency: number
  readonly promptAdherence: number
  readonly textRendering: number
}

/** 画像は秒課金ではなく 1 枚いくらで課金される。 */
export type ImageModelEconomics = {
  readonly costPerImageUsd: number
  readonly typicalLatencySec: number
}

/** モデル 1 つ分の宣言。capability はバリデーション、qualities は Router のスコアリングに使う。 */
export type ImageModelDescriptor = {
  readonly id: ModelId
  readonly providerId: ProviderId
  readonly label: string
  readonly capabilities: ImageModelCapabilities
  readonly qualities: ImageModelQualities
  readonly economics: ImageModelEconomics
}

/** Domain から Provider へ渡す要求。参照は解決済みのアセット ID で渡す。 */
export type ImageGenerationRequest = {
  readonly model: ImageModelDescriptor
  readonly prompt: string
  readonly negativePrompt: string | null
  readonly resolution: Resolution
  readonly aspectRatio: AspectRatio
  readonly seed: number | null
  readonly references: readonly { readonly mediaAssetId: MediaAssetId; readonly role: ReferenceRole }[]
  /** 参照アセットを Provider が読める形にするための解決関数（署名付き URL やローカルパス）。 */
  readonly resolveReference: (id: MediaAssetId) => Promise<string>
  /** 生成する枚数。四面図は 1 枚、Look 候補は複数。 */
  readonly count: number
}

/**
 * 画像ジョブの状態。`ProviderJobStatus` と同じ形だが、**succeeded が複数枚を返す**点だけが違う。
 *
 * 1 リクエストで複数候補を出せるのが画像生成の常であり（Look 候補の出し分け）、
 * 動画側の `output: ProviderOutput` 1 件では表現できない。
 * それ以外（pending / running / failed、ProviderOutput の remote・local 判別）は
 * 動画と完全に共有する。
 */
export type ImageJobStatus =
  | { readonly state: 'pending' | 'running'; readonly progress: number | null }
  | {
      readonly state: 'succeeded'
      /** 生成された枚数ぶん。要求した `count` と同じ順序で並ぶ。 */
      readonly outputs: readonly ProviderOutput[]
      readonly seedUsed: number | null
      readonly costUsd: number
      readonly raw: Record<string, unknown>
    }
  | {
      readonly state: 'failed'
      readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean }
    }

/**
 * すべての画像 Provider が実装する interface。
 * HTTP・CLI・ローカルのいずれの形態でもこの形に合わせる（ADR-0004 / 0012 / 0014）。
 * 同期 API しか無い Provider も「即座に完了するジョブ」として包むこと。
 *
 * ハンドルは動画と共有の `ProviderJobHandle` を使う。ジョブの指し方に画像固有の事情は無い。
 */
export interface ImageProvider {
  readonly id: ProviderId
  readonly models: readonly ImageModelDescriptor[]
  submit(request: ImageGenerationRequest): Promise<ProviderJobHandle>
  poll(handle: ProviderJobHandle): Promise<ImageJobStatus>
  cancel(handle: ProviderJobHandle): Promise<void>
  /**
   * 呼び出し側が出力を取り込み終えたあとの片付け（手元に置いた出力や作業ディレクトリを消す）。
   * 手元に何も置かない Provider は持たなくてよい。呼んだあとの poll は「記録が無い」になる。
   */
  release?(handle: ProviderJobHandle): Promise<void>
}

const describeResolutions = (resolutions: readonly Resolution[]): string =>
  resolutions.map((r) => `${r.width}x${r.height}`).join(' / ')

/**
 * 要求がモデルの能力に収まるかを検査する。
 * 満たせない理由をすべて列挙する（1 つ見つけて止めない）。呼び出し側が原因をまとめて直せるため。
 */
export const validateImageRequest = (
  request: ImageGenerationRequest,
  model: ImageModelDescriptor,
): string[] => {
  const caps = model.capabilities
  const violations: string[] = []

  if (request.prompt.trim().length === 0) {
    violations.push('プロンプトが空')
  }

  if (!Number.isInteger(request.count) || request.count < 1) {
    violations.push(`生成枚数 ${request.count} は 1 以上の整数でなければならない`)
  }

  const hasResolution = caps.resolutions.some(
    (r) => r.width === request.resolution.width && r.height === request.resolution.height,
  )
  if (!hasResolution) {
    violations.push(
      `解像度 ${request.resolution.width}x${request.resolution.height} に非対応（対応: ${describeResolutions(caps.resolutions)}）`,
    )
  }

  if (!caps.aspectRatios.includes(request.aspectRatio)) {
    violations.push(
      `アスペクト比 ${request.aspectRatio} に非対応（対応: ${caps.aspectRatios.join(', ')}）`,
    )
  }

  if (request.references.length > caps.referenceImages.max) {
    violations.push(
      `参照画像が ${request.references.length} 枚あるが上限は ${caps.referenceImages.max} 枚`,
    )
  }

  const unsupportedRoles = [
    ...new Set(
      request.references
        .map((r) => r.role)
        .filter((role) => !caps.referenceImages.roles.includes(role)),
    ),
  ]
  if (unsupportedRoles.length > 0) {
    violations.push(`未対応の参照ロール: ${unsupportedRoles.join(', ')}`)
  }

  if (request.seed !== null && !caps.seed) {
    violations.push('seed 指定に非対応')
  }

  if (request.negativePrompt !== null && !caps.negativePrompt) {
    violations.push('negative prompt に非対応')
  }

  return violations
}

export const canGenerateImage = (
  request: ImageGenerationRequest,
  model: ImageModelDescriptor,
): boolean => validateImageRequest(request, model).length === 0
