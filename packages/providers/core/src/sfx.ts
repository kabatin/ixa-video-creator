import type { ModelId, ProviderId } from '@ixa/domain'
import type { ExclusiveResource, ProviderJobHandle } from './provider.js'

/**
 * 効果音を作る AI の口（ADR-0052）。曲の `MusicProvider` と同じく、投入 → 問い合わせ → 取り込みのジョブ式。
 * 1 つの要求で複数本を作れる。出来上がりは手元のファイル（WAV）に書く（外の URL を取りに行かない）。
 */

export type SfxModelDescriptor = {
  readonly id: ModelId
  readonly providerId: ProviderId
  readonly label: string
  /** サーバ側のワークフロー名（`stable-audio-3-sfx` など）。 */
  readonly workflowId: string
  /** 作れる長さ（秒）。 */
  readonly durationSec: { readonly min: number; readonly max: number }
  /** 1 回で作れる本数の上限。 */
  readonly maxCount: number
  /** 出来上がりの標本化周波数（Hz）。記録と案内のため。 */
  readonly sampleRate: number
  /**
   * 投入してから仕上がるまで待つ上限（秒。GPU の順番待ちは別）。モデルで桁が違う
   * （Stable Audio は 1 本 1 秒未満、MOSS は 2 秒の音で数分）。
   */
  readonly maxWaitSec: number
}

/** Domain から Provider へ渡す要求。範囲は呼ぶ側（`SfxJobSpec`）で検査済み。 */
export type SfxGenerationRequest = {
  readonly model: SfxModelDescriptor
  /** 何の音か（英語）。 */
  readonly prompt: string
  /** 入れたくない音（英語）。無ければ null。 */
  readonly negativePrompt: string | null
  readonly durationSec: number
  readonly seed: number | null
  readonly count: number
  /** 投げ直しても二重に作らせないための鍵（効果音のジョブの ID）。 */
  readonly idempotencyKey?: string
}

/** 出来上がった 1 本。手元に書いた WAV と、実際の長さ（秒）・標本化周波数。 */
export type SfxOutput = {
  readonly path: string
  readonly durationSec: number
  readonly sampleRate: number
  /** 1 ならモノラル（MOSS）、2 ならステレオ（Stable Audio）。 */
  readonly channels: number
  /**
   * この 1 本の種。**これが正**（サーバは i 本目に seed + 2i を使う）。この種を本数 1 で送ると同じ音が返る。
   */
  readonly seedUsed: number | null
}

export type SfxJobStatusFromProvider =
  | { readonly state: 'pending' | 'running'; readonly progress: number | null }
  | {
      readonly state: 'succeeded'
      /** 作った本数ぶん。番号順に並ぶ。 */
      readonly outputs: readonly SfxOutput[]
      readonly costUsd: number
      readonly raw: Record<string, unknown>
    }
  | {
      readonly state: 'failed'
      readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean }
    }

export interface SfxProvider {
  readonly id: ProviderId
  readonly models: readonly SfxModelDescriptor[]
  /** 同時に使ってはいけない資源。手元の GPU を使う Provider は `local-gpu` を名乗る。 */
  readonly exclusiveResource?: ExclusiveResource
  submit(request: SfxGenerationRequest): Promise<ProviderJobHandle>
  poll(handle: ProviderJobHandle): Promise<SfxJobStatusFromProvider>
  cancel(handle: ProviderJobHandle): Promise<void>
  /** 取り込み終えたあとの片付け（手元に置いた WAV を消す）。 */
  release?(handle: ProviderJobHandle): Promise<void>
}
