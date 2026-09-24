import { quantizeDuration } from '@ixa/domain'
import type { ModelId } from '@ixa/domain'
import {
  CapabilityViolationError,
  ProviderError,
  validateAgainstCapabilities,
  type ProviderJobHandle,
  type ProviderJobStatus,
  type VideoGenerationRequest,
  type VideoModelDescriptor,
  type VideoProvider,
} from '@ixa/provider-core'
import { z } from 'zod'
import {
  FAL_MODEL_PATHS,
  FAL_PROVIDER_ID,
  FAL_QUEUE_BASE_URL,
  falVideoModels,
} from './descriptor.js'
import {
  falErrorFor,
  FalRequestError,
  falRequest,
  formatIssues,
  reasonFrom,
  type FalFetch,
  type FalHttp,
} from './http.js'
import { decodeFalJobRef, encodeFalJobRef } from './job-ref.js'
import {
  FalFailurePayload,
  FalSeedanceOutput,
  FalStatusResponse,
  FalSubmitResponse,
} from './queue-api.js'
import { buildSeedanceInput, FAL_GENERATE_AUDIO } from './request.js'

export type { FalFetch } from './http.js'

export const FalVideoProviderSettings = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().default(FAL_QUEUE_BASE_URL),
  /** 1 回の HTTP に掛ける上限。ハングしたジョブがキューを詰まらせないため必ず設定する。 */
  timeoutMs: z
    .number()
    .int()
    .positive()
    .default(60 * 1000),
})

export type FalVideoProviderOptions = {
  apiKey: string
  baseUrl?: string
  timeoutMs?: number
  /** テストから差し替える口。既定はグローバルの `fetch`。 */
  fetch?: FalFetch
}

const defaultFetch: FalFetch = (url, init) => fetch(url, init)

const unknownModel = (modelId: ModelId): ProviderError =>
  new ProviderError(`fal アダプタは未知のモデル ${modelId} を扱えません`, FAL_PROVIDER_ID, false)

/** モデルとエンドポイント経路を同時に引く。片方だけ解決できる状態を作らない。 */
const resolveModel = (
  modelId: ModelId,
): { readonly model: VideoModelDescriptor; readonly path: string } => {
  const model = falVideoModels.find((candidate) => candidate.id === modelId)
  const path = FAL_MODEL_PATHS[modelId]
  if (model === undefined || path === undefined) throw unknownModel(modelId)
  return { model, path }
}

const failed = (
  code: string,
  message: string,
  retryable: boolean,
): Extract<ProviderJobStatus, { state: 'failed' }> => ({
  state: 'failed',
  error: { code, message, retryable },
})

const failedFromRequestError = (
  error: FalRequestError,
): Extract<ProviderJobStatus, { state: 'failed' }> =>
  failed(error.code, error.message, error.retryable)

/** 応答の形が違うとき。**pending へ丸めない。** 終わらないジョブを回し続けることになる。 */
const invalidResponse = (
  what: string,
  error: z.ZodError,
): Extract<ProviderJobStatus, { state: 'failed' }> =>
  failed('fal_invalid_response', `fal の${what}応答が仕様と違います: ${formatIssues(error)}`, false)

/** `error_type` は機械向けの識別子。コードに使う前に記号を落とす。 */
const codeFromErrorType = (errorType: string | null | undefined): string => {
  const cleaned = (errorType ?? '').replace(/[^A-Za-z0-9_]/g, '')
  return cleaned === '' ? 'fal_generation_failed' : `fal_${cleaned}`
}

/**
 * 生成そのものが失敗した応答。**理由は必ず載せる（空にしない）が、URL は落とす。**
 * 理由が空だと画面には「失敗しました」としか出ず、直しようがなくなる。
 */
const generationFailed = (
  payload: FalFailurePayload,
): Extract<ProviderJobStatus, { state: 'failed' }> =>
  failed(
    codeFromErrorType(payload.error_type),
    `fal の生成が失敗しました: ${reasonFrom({ error: payload.error }, '理由不明')}`,
    // 理由が付いた失敗は入力かモデル側の都合であり、投げ直しても同じ結果になる。
    false,
  )

const hasFailure = (payload: FalFailurePayload): boolean =>
  (payload.error ?? '').trim() !== '' || (payload.error_type ?? '').trim() !== ''

/**
 * fal.ai の Seedance アダプタ（ADR-0013 Phase 1）。
 *
 * - SDK を足さず素の `fetch` で書く。`fetch` と API キーは**引数で受ける**ので、
 *   契約テストはモック応答だけで完結する（実 API を CI で叩かない）。
 * - `process.env` はここから読まない。設定は `packages/config` が読んで配線が渡す。
 * - 出力は `{ type: 'remote', url }`。期限付き URL なので DB に保存せず、
 *   **例外にもログにも raw にも載せない**（CLAUDE.md 規約 7）。
 */
export const createFalVideoProvider = (options: FalVideoProviderOptions): VideoProvider => {
  const { apiKey, baseUrl, timeoutMs } = FalVideoProviderSettings.parse({
    apiKey: options.apiKey,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })

  const http: FalHttp = {
    fetch: options.fetch ?? defaultFetch,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    timeoutMs,
  }

  const endpoint = (path: string): string => `${http.baseUrl}/${path}`
  const requestUrl = (path: string, requestId: string): string =>
    `${endpoint(path)}/requests/${encodeURIComponent(requestId)}`

  const submit = async (request: VideoGenerationRequest): Promise<ProviderJobHandle> => {
    const { model, path } = resolveModel(request.model.id)
    const violations = validateAgainstCapabilities(request.spec, model)
    if (violations.length > 0) throw new CapabilityViolationError(model.id, violations)

    const generationDurationSec = quantizeDuration(
      request.spec.durationSec,
      model.capabilities.durations,
    )

    // 並びは `spec.references` のまま保つ。`Promise.all` は入力順に解決する。
    const referenceUrls = await Promise.all(
      request.spec.references.map((reference) => request.resolveReference(reference.mediaAssetId)),
    )

    const input = buildSeedanceInput({ spec: request.spec, generationDurationSec, referenceUrls })
    const response = await falRequest(http, 'POST', endpoint(path), input)

    if (!response.ok) throw falErrorFor(response.status, response.body, '投入')

    const parsed = FalSubmitResponse.safeParse(response.body)
    if (!parsed.success) {
      throw new FalRequestError(
        'fal_invalid_response',
        `fal の投入応答が仕様と違います: ${formatIssues(parsed.error)}`,
        false,
        response.status,
      )
    }

    return {
      providerId: FAL_PROVIDER_ID,
      modelId: model.id,
      ref: encodeFalJobRef(parsed.data.request_id, generationDurationSec),
      submittedAt: new Date(),
    }
  }

  /** 完了した要求の結果を取りに行き、Take に残せる形へ落とす。 */
  const fetchResult = async (
    model: VideoModelDescriptor,
    path: string,
    requestId: string,
    generationDurationSec: number,
    inferenceTimeSec: number | null,
  ): Promise<ProviderJobStatus> => {
    const response = await falRequest(http, 'GET', requestUrl(path, requestId))
    if (!response.ok) {
      const payload = FalFailurePayload.safeParse(response.body)
      if (payload.success && hasFailure(payload.data)) return generationFailed(payload.data)
      return failedFromRequestError(falErrorFor(response.status, response.body, '結果の取得'))
    }

    const parsed = FalSeedanceOutput.safeParse(response.body)
    if (!parsed.success) {
      // 出力ではなく失敗が返っていることがある。形が違う理由を先に確かめる。
      const payload = FalFailurePayload.safeParse(response.body)
      if (payload.success && hasFailure(payload.data)) return generationFailed(payload.data)
      return invalidResponse('結果', parsed.error)
    }

    const { video, seed } = parsed.data
    return {
      state: 'succeeded',
      // 期限付き URL。呼び出し側が即座にダウンロードして捨てる（ARCHITECTURE.md §11）。
      output: { type: 'remote', url: video.url },
      seedUsed: seed ?? null,
      /**
       * **応答に費用は入っていない。** descriptor の単価 × 生成尺で出す。
       * 単価は映像入力なしのほう。このアダプタは `video_urls` を使わない
       * （ドメインの参照 role はすべて静止画）。
       */
      costUsd: model.economics.costPerSecondUsd * generationDurationSec,
      /**
       * `Take.providerParams` に残る記録。**署名付き URL は 1 つも入れない**（規約 7）。
       *
       * 送った入力そのものを持たないのは、`poll` に仕様が渡ってこないため。
       * ただし `buildSeedanceInput` は仕様の純関数なので、`Take.spec` から
       * いつでも同じ要求を組み直せる。ここには組み直しでは分からないことだけを残す。
       */
      raw: {
        provider: 'fal',
        modelPath: path,
        requestId,
        generationDurationSec,
        costPerSecondUsd: model.economics.costPerSecondUsd,
        generateAudio: FAL_GENERATE_AUDIO,
        inferenceTimeSec,
        // URL は入れない。形式と大きさだけ残す。
        videoContentType: video.content_type ?? null,
        videoFileName: video.file_name ?? null,
        videoBytes: video.file_size ?? null,
      },
    }
  }

  const poll = async (handle: ProviderJobHandle): Promise<ProviderJobStatus> => {
    const { model, path } = resolveModel(handle.modelId)
    const { requestId, generationDurationSec } = decodeFalJobRef(handle.ref)

    try {
      const response = await falRequest(http, 'GET', `${requestUrl(path, requestId)}/status`)
      if (!response.ok) {
        return failedFromRequestError(falErrorFor(response.status, response.body, '状態の取得'))
      }

      // 失敗はどの状態にも付きうるので、status を見る前に確かめる。
      const failure = FalFailurePayload.safeParse(response.body)
      if (failure.success && hasFailure(failure.data)) return generationFailed(failure.data)

      const parsed = FalStatusResponse.safeParse(response.body)
      if (!parsed.success) return invalidResponse('状態', parsed.error)

      const status = parsed.data
      if (status.status === 'IN_QUEUE') {
        // `queue_position` は待ち行列の位置であって進み具合ではない。progress にしない。
        return { state: 'pending', progress: null }
      }
      if (status.status === 'IN_PROGRESS') {
        // fal が返すのは logs だけで、割合は出てこない。
        return { state: 'running', progress: null }
      }

      return await fetchResult(
        model,
        path,
        requestId,
        generationDurationSec,
        status.metrics?.inference_time ?? null,
      )
    } catch (error) {
      // HTTP の失敗は「ジョブの失敗」として理由つきで返す。握り潰さない。
      if (error instanceof FalRequestError) return failedFromRequestError(error)
      throw error
    }
  }

  const cancel = async (handle: ProviderJobHandle): Promise<void> => {
    const { path } = resolveModel(handle.modelId)
    const { requestId } = decodeFalJobRef(handle.ref)
    const response = await falRequest(http, 'PUT', `${requestUrl(path, requestId)}/cancel`)

    // 202 CANCELLATION_REQUESTED / 400 ALREADY_COMPLETED / 404 NOT_FOUND は
    // いずれも「もう止める対象が無い」であり、cancel の契約からすれば成功である。
    if (response.ok || response.status === 400 || response.status === 404) return

    throw falErrorFor(response.status, response.body, '取消')
  }

  return {
    id: FAL_PROVIDER_ID,
    models: falVideoModels,
    submit,
    poll,
    cancel,
  }
}
