import type { ModelId, ProviderId } from '@ixa/domain'
import type { ExclusiveResource, ProviderJobHandle } from './provider.js'

/**
 * 曲を作る AI の口（ADR-0048）。画像の `ImageProvider` と同じく、投入 → 問い合わせ → 取り込みのジョブ式。
 * 1 つの要求で複数曲を作れる。出来上がりは手元のファイル（WAV）に書く（外の URL を取りに行かない）。
 */

export type MusicModelDescriptor = {
  readonly id: ModelId
  readonly providerId: ProviderId
  readonly label: string
  /** 作れる長さ（秒）。 */
  readonly durationSec: { readonly min: number; readonly max: number }
  /** 1 回で作れる曲の数の上限。 */
  readonly maxCount: number
}

/** Domain から Provider へ渡す要求。範囲は呼ぶ側（`MusicJobSpec`）で検査済み。 */
export type MusicGenerationRequest = {
  readonly model: MusicModelDescriptor
  /** 曲調（スタイルのタグ）。 */
  readonly prompt: string
  /** 歌詞。空なら歌詞なし。 */
  readonly lyrics: string
  readonly durationSec: number
  /** 歌なし。true なら歌詞は送っても使われない。 */
  readonly instrumental: boolean
  readonly seed: number | null
  readonly count: number
  /** 投げ直しても二重に作らせないための鍵（曲のジョブの ID）。 */
  readonly idempotencyKey?: string
}

/** 出来上がった 1 曲。手元に書いた WAV と、実際の長さ（秒）。 */
export type MusicOutput = {
  readonly path: string
  readonly durationSec: number
}

export type MusicJobStatusFromProvider =
  | { readonly state: 'pending' | 'running'; readonly progress: number | null }
  | {
      readonly state: 'succeeded'
      /** 作った曲の数ぶん。番号順に並ぶ。 */
      readonly outputs: readonly MusicOutput[]
      readonly seedUsed: number | null
      readonly costUsd: number
      readonly raw: Record<string, unknown>
    }
  | {
      readonly state: 'failed'
      readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean }
    }

export interface MusicProvider {
  readonly id: ProviderId
  readonly models: readonly MusicModelDescriptor[]
  /** 同時に使ってはいけない資源。手元の GPU を使う Provider は `local-gpu` を名乗る。 */
  readonly exclusiveResource?: ExclusiveResource
  submit(request: MusicGenerationRequest): Promise<ProviderJobHandle>
  poll(handle: ProviderJobHandle): Promise<MusicJobStatusFromProvider>
  cancel(handle: ProviderJobHandle): Promise<void>
  /** 取り込み終えたあとの片付け（手元に置いた WAV を消す）。 */
  release?(handle: ProviderJobHandle): Promise<void>
}
