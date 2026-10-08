import type { ModelId, ProviderId, Resolution } from '@ixa/domain'
import type { ExclusiveResource, ProviderJobHandle, ProviderJobStatus } from './provider.js'

/**
 * 出来上がった動画の**解像度を上げる**口（ADR-0044）。
 *
 * `VideoProvider` とは**入力が違う**。あちらは仕様（`ShotGenerationSpec`）から作るが、
 * こちらは**出来上がった動画そのもの**を渡して作り直す。仕様が無いので同じ型には乗らない。
 *
 * 問い合わせ（`poll`）と取消（`cancel`）は生成と同じ形を返す。worker 側の待ち方・失敗の扱いを
 * 2 通り持たないため（`ProviderJobStatus` をそのまま使う）。
 */

export type VideoUpscaleSource = {
  /** base64 の MP4。**サーバへそのまま渡す。** */
  readonly data: string
  readonly mediaType: 'video/mp4'
}

export type VideoUpscaleRequest = {
  readonly video: VideoUpscaleSource
  /**
   * 出す大きさ。**必ず明示する。** サーバの既定に頼ると、版が変わったときに
   * 黙って違う大きさで返ってくる。
   */
  readonly output: Resolution
  /** 投げ直しても二重に作らせないための鍵。`GenerationJob` の ID と同じ考え方。 */
  readonly idempotencyKey: string
}

export type VideoUpscaleSubmission = {
  readonly handle: ProviderJobHandle
  /**
   * サーバが投入時に返した見込み（秒）。**走っている間の「あと何分」はこれを正とする。**
   * 返さないサーバ・古い版では null。
   */
  readonly estimateSeconds: number | null
}

export type VideoUpscaler = {
  readonly providerId: ProviderId
  readonly modelId: ModelId
  /** 同時に使ってはいけない資源。手元の GPU を使うなら生成と順番を共有する。 */
  readonly exclusiveResource?: ExclusiveResource
  /**
   * そのサーバが解像度上げに対応しているか。**サーバに訊く**（ワークフローの一覧を見る）。
   * 対応していない版へ投げて失敗させないため、押す前の判定にも使う。
   */
  available(): Promise<boolean>
  submit(request: VideoUpscaleRequest): Promise<VideoUpscaleSubmission>
  poll(handle: ProviderJobHandle): Promise<ProviderJobStatus>
  cancel(handle: ProviderJobHandle): Promise<void>
}
