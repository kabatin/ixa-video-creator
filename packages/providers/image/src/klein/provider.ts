import { rm } from 'node:fs/promises'
import {
  CapabilityViolationError,
  ProviderBusyError,
  validateImageRequest,
  type ImageGenerationRequest,
  type ImageJobStatus,
  type ImageProvider,
  type ProviderJobHandle,
} from '@ixa/provider-core'
import {
  decodeLocalServerJobRef,
  encodeLocalServerJobRef,
  ensurePromptLength,
  hasSavedOutput,
  idempotencyKeyOf,
  localServerErrorFor,
  localServerInvalidResponseCode,
  localServerNoResponseCode,
  localServerOpen,
  localServerOutputPath,
  localServerRequest,
  LocalServerRequestError,
  readErrorBody,
  reasonOf,
  retryAfterMsFrom,
  saveOutputAtomically,
  type LocalServerFetch,
  type LocalServerHttp,
} from '@ixa/provider-video'
import { KleinJob, KleinSubmitResponse, type KleinOutputInfo } from './api.js'
import { KLEIN_IDENTITY, KLEIN_WORKFLOW_ID, kleinImageModel } from './descriptor.js'
import { readKleinReferences } from './references.js'

/**
 * klein-api（FLUX.2 [klein]）の画像アダプタ（ADR-0047）。
 *
 * やりとりの作法（冪等キー・429・失敗の封筒・`/v1/jobs/{id}`）は vpipe-api v1 と同じなので、
 * 下回りは動画の `local-server/` の部品を使う（vpipe の高画質化と同じ使い方）。
 * 違うのは本文と、出来上がりが**複数枚の PNG** であることだけ。
 *
 * **手元の GPU を使う**（`exclusiveResource: 'local-gpu'`）。worker は動画・高画質化と同じ整理券に並ばせる。
 */

/** 1 回の HTTP の上限。投入の本文は参照 4 枚で最大 100MB 近くになる。 */
export const KLEIN_REQUEST_TIMEOUT_MS = 60_000
/** 出来上がり 1 枚を取り込む上限。1MP の PNG は数 MB。 */
export const KLEIN_DOWNLOAD_TIMEOUT_MS = 120_000
/** 1 つのジョブで作れる枚数の上限（klein-api の契約 `count` 1〜4）。 */
export const KLEIN_MAX_COUNT = 4
/** 出来上がり 1 枚の上限。2048×2048 の PNG でも 20MB に届かない。 */
export const KLEIN_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

export type KleinImageProviderOptions = {
  readonly baseUrl: string
  /** 未設定は null（空の Bearer を送らない）。 */
  readonly token: string | null
  /** 取り込んだ PNG を置く場所。 */
  readonly outputDir: string
  readonly fetch?: LocalServerFetch
  readonly timeoutMs?: number
  readonly downloadTimeoutMs?: number
}

const identity = KLEIN_IDENTITY
const invalidCode = localServerInvalidResponseCode(identity)
const jobPath = (jobId: string): string => `/v1/jobs/${encodeURIComponent(jobId)}`

/** 出来上がり 1 枚の置き場所。ジョブ ID は `LocalServerJobId` で検査済み（`../` を含まない）。 */
const outputName = (jobId: string, index: number): string => `${jobId}-${String(index)}`

const failed = (code: string, message: string, retryable: boolean): ImageJobStatus => ({
  state: 'failed',
  error: { code, message, retryable },
})

export const createKleinImageProvider = (options: KleinImageProviderOptions): ImageProvider => {
  const http: LocalServerHttp = {
    identity,
    fetch: options.fetch ?? globalThis.fetch,
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    token: options.token,
    timeoutMs: options.timeoutMs ?? KLEIN_REQUEST_TIMEOUT_MS,
  }
  const downloadHttp: LocalServerHttp = {
    ...http,
    timeoutMs: options.downloadTimeoutMs ?? KLEIN_DOWNLOAD_TIMEOUT_MS,
  }
  const { outputDir } = options

  const download = async (jobId: string, index: number): Promise<string> => {
    const existing = localServerOutputPath(outputDir, outputName(jobId, index), 'png')
    if (await hasSavedOutput(existing)) return existing
    const { response } = await localServerOpen(
      downloadHttp,
      `${jobPath(jobId)}/output?index=${String(index)}`,
      'image/png',
    )
    if (!response.ok) {
      throw localServerErrorFor(identity, response.status, await readErrorBody(response), '出力の取得')
    }
    if (response.body === null) {
      throw new LocalServerRequestError(identity.providerId, invalidCode, `${identity.label}の出力が空でした`, false, response.status)
    }
    try {
      const saved = await saveOutputAtomically(outputDir, outputName(jobId, index), response.body, KLEIN_MAX_OUTPUT_BYTES, 'png')
      return saved.path
    } catch (error) {
      // 本文の途中で切れた。向こうでは出来ているので、やり直せる失敗にする（vpipe の高画質化と同じ）。
      throw new LocalServerRequestError(
        identity.providerId,
        localServerNoResponseCode(identity),
        `${identity.label}の出力を取り込む途中で切れました`,
        true,
        response.status,
        { cause: error },
      )
    }
  }

  /** 番号が 0 から欠けずに並んでいるか。途中の欠けた成功を「成功」として返さない（頼んだ枚数との照合は呼ぶ側）。 */
  const completeOutputs = (outputs: readonly KleinOutputInfo[], jobId: string): readonly KleinOutputInfo[] => {
    const sorted = [...outputs].sort((a, b) => a.index - b.index)
    const contiguous = sorted.every((output, position) => output.index === position)
    if (!contiguous) {
      throw new LocalServerRequestError(
        identity.providerId,
        invalidCode,
        `${identity.label}の出来上がりの番号が揃っていません（${jobId}）`,
        false,
        null,
      )
    }
    return sorted
  }

  return {
    id: identity.providerId,
    models: [kleinImageModel],
    exclusiveResource: 'local-gpu',

    async submit(request: ImageGenerationRequest): Promise<ProviderJobHandle> {
      const violations = validateImageRequest(request, request.model)
      if (violations.length > 0) throw new CapabilityViolationError(request.model.id, violations)
      ensurePromptLength(identity, request.prompt)
      const key = idempotencyKeyOf(identity, request.idempotencyKey)
      const references = await readKleinReferences(request)

      const response = await localServerRequest(
        http,
        'POST',
        `/v1/workflows/${KLEIN_WORKFLOW_ID}/jobs`,
        {
          prompt: request.prompt,
          // **常に明示する。** サーバの既定に頼ると、版が変わったとき黙って違う大きさで返る。
          output: { width: request.resolution.width, height: request.resolution.height },
          // ixa が使う段は standard だけ（ADR-0047 §2）。
          quality: 'standard',
          seed: request.seed,
          count: request.count,
          reference_images: references,
        },
        key === null ? {} : { 'Idempotency-Key': key },
      )
      if (response.status === 429) {
        throw new ProviderBusyError(`${identity.label}が混んでいます`, identity.providerId, retryAfterMsFrom(response.headers))
      }
      if (!response.ok) throw localServerErrorFor(identity, response.status, response.body, '投入')

      const parsed = KleinSubmitResponse.safeParse(response.body)
      if (!parsed.success) {
        throw new LocalServerRequestError(identity.providerId, invalidCode, `${identity.label}の投入応答が仕様と違います`, false, response.status)
      }
      return {
        providerId: identity.providerId,
        modelId: kleinImageModel.id,
        ref: encodeLocalServerJobRef(identity, parsed.data.id),
        submittedAt: new Date(),
      }
    },

    async poll(handle: ProviderJobHandle): Promise<ImageJobStatus> {
      const jobId = decodeLocalServerJobRef(identity, handle.ref)
      const response = await localServerRequest(http, 'GET', jobPath(jobId))
      if (!response.ok) throw localServerErrorFor(identity, response.status, response.body, '状態の取得')

      const parsed = KleinJob.safeParse(response.body)
      if (!parsed.success) return failed(invalidCode, `${identity.label}の状態応答が仕様と違います`, false)
      const job = parsed.data
      if (job.id !== jobId) {
        return failed(invalidCode, `${identity.label}の状態応答が、問い合わせたのと別のジョブを指しています`, false)
      }

      switch (job.status) {
        case 'queued':
          return { state: 'pending', progress: null }
        case 'running':
          return { state: 'running', progress: job.progress ?? null }
        case 'failed':
          return failed(
            `${identity.codePrefix}_${job.error?.code ?? 'generation_failed'}`,
            `${identity.label}で絵を作れませんでした: ${reasonOf(job.error?.message ?? '')}`,
            job.error?.retryable ?? false,
          )
        case 'canceled':
          return failed(`${identity.codePrefix}_canceled`, `${identity.label}で絵を作るのは取り消されました`, false)
        case 'succeeded': {
          const outputs = completeOutputs(job.result.outputs, job.id)
          const paths = await Promise.all(outputs.map((output) => download(job.id, output.index)))
          return {
            state: 'succeeded',
            outputs: paths.map((path) => ({ type: 'local', path })),
            seedUsed: job.result.seed_used,
            // 手元の GPU。費用は掛からない。
            costUsd: 0,
            raw: {
              workflow: KLEIN_WORKFLOW_ID,
              outputs: outputs.map(({ index, width, height, seed_used }) => ({ index, width, height, seed_used })),
              ...(job.timings === null || job.timings === undefined ? {} : { timings: job.timings }),
            },
          }
        }
      }
    },

    async cancel(handle: ProviderJobHandle): Promise<void> {
      const jobId = decodeLocalServerJobRef(identity, handle.ref)
      const response = await localServerRequest(http, 'DELETE', jobPath(jobId))
      // 409（もう終わっている）と 404（記録が無い）は「止める対象が無い」＝ 取消としては成功。
      if (response.ok || response.status === 409 || response.status === 404) return
      throw localServerErrorFor(identity, response.status, response.body, '取消')
    },

    /** 取り込んだ PNG を消す。worker が切り抜いて写したら要らない。 */
    async release(handle: ProviderJobHandle): Promise<void> {
      const jobId = decodeLocalServerJobRef(identity, handle.ref)
      await Promise.all(
        Array.from({ length: KLEIN_MAX_COUNT }, (_, index) =>
          rm(localServerOutputPath(outputDir, outputName(jobId, index), 'png'), { force: true }),
        ),
      )
    },
  }
}
