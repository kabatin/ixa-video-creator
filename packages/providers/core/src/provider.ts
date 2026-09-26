import type { MediaAssetId, ModelId, ProviderId, ShotGenerationSpec } from '@ixa/domain'
import type { ModelEconomics, ModelQualities, VideoModelCapabilities } from './capabilities.js'

/** モデル 1 つ分の宣言。capability はバリデーション、qualities は Router のスコアリングに使う。 */
export type VideoModelDescriptor = {
  readonly id: ModelId
  readonly providerId: ProviderId
  readonly label: string
  readonly capabilities: VideoModelCapabilities
  readonly qualities: ModelQualities
  readonly economics: ModelEconomics
  /**
   * AUTO（Model Router）の候補にするか。**省略は候補にする。**
   * ローカルの画像→動画は false（ADR-0025）。最初のフレームを付けただけで AUTO が
   * 無料の寄りへ切り替わると、生成を頼んだつもりが画像を動かすだけになる。明示して選ばせる。
   */
  readonly routable?: boolean
}

/** Provider 側のジョブを指す不透明なハンドル。中身の形は Provider ごとに異なる。 */
export type ProviderJobHandle = {
  readonly providerId: ProviderId
  readonly modelId: ModelId
  readonly ref: string
  readonly submittedAt: Date
}

export type ProviderJobStatus =
  | { readonly state: 'pending' | 'running'; readonly progress: number | null }
  | {
      readonly state: 'succeeded'
      readonly output: ProviderOutput
      readonly seedUsed: number | null
      readonly costUsd: number
      readonly raw: Record<string, unknown>
    }
  | {
      readonly state: 'failed'
      readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean }
    }

/**
 * 生成物の所在。**リモートとローカルを型で区別する。**
 *
 * リモート URL は Provider が返す外部由来の値であり、SSRF の検査対象になる。
 * 一方ローカル Provider（スタブなど）の出力は自プロセスが書いたファイルで、
 * 攻撃者の制御下にない。これを同じ `string` で扱うと、
 * どちらかに合わせて検査を緩めるか、正しい経路が塞がれるかのどちらかになる。
 */
export type ProviderOutput =
  | {
      readonly type: 'remote'
      /** 期限付き URL。**DB に保存せず即ダウンロードすること**（ARCHITECTURE.md §9） */
      readonly url: string
    }
  | {
      readonly type: 'local'
      /** 自プロセスが書いたファイルの絶対パス。HTTP を経由しない。 */
      readonly path: string
    }

/** Domain から Provider へ渡す要求。参照は解決済みのアセット ID で渡す。 */
export type VideoGenerationRequest = {
  readonly model: VideoModelDescriptor
  readonly spec: ShotGenerationSpec
  /** 参照アセットを Provider が読める形にするための解決関数（署名付き URL やローカルパス）。 */
  readonly resolveReference: (id: MediaAssetId) => Promise<string>
}

/**
 * すべての動画 Provider が実装する interface。
 * HTTP・CLI・ローカルのいずれの形態でもこの形に合わせる（ADR-0004 / 0012 / 0014）。
 * 同期 API しか無い Provider も「即座に完了するジョブ」として包むこと。
 */
export interface VideoProvider {
  readonly id: ProviderId
  readonly models: readonly VideoModelDescriptor[]
  submit(request: VideoGenerationRequest): Promise<ProviderJobHandle>
  poll(handle: ProviderJobHandle): Promise<ProviderJobStatus>
  cancel(handle: ProviderJobHandle): Promise<void>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: ProviderId,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ProviderError'
  }
}

export class CapabilityViolationError extends Error {
  constructor(readonly modelId: ModelId, readonly violations: readonly string[]) {
    super(`モデル ${modelId} では次の要求を満たせません:\n- ${violations.join('\n- ')}`)
    this.name = 'CapabilityViolationError'
  }
}
