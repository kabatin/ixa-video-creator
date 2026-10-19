import { rm } from 'node:fs/promises'
import {
  ProviderBusyError,
  type MusicGenerationRequest,
  type MusicJobStatusFromProvider,
  type MusicProvider,
  type ProviderJobHandle,
} from '@ixa/provider-core'
import {
  decodeLocalServerJobRef,
  encodeLocalServerJobRef,
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
import { SfxApiJob, SfxApiSubmitResponse, type SfxApiOutputInfo } from './api.js'
import { SFX_API_MUSIC_IDENTITY, STABLE_AUDIO_MUSIC_WORKFLOW_ID, stableAudioMusicModel } from './music-descriptor.js'
import { ensureSfxApiMusicRequest } from './music-request.js'
import { SFX_API_REQUEST_TIMEOUT_MS, SFX_WORKFLOW_UNAVAILABLE_CODE, SfxApiUnavailableEnvelope } from './provider.js'

/**
 * sfx-api の歌なし BGM（Stable Audio 3 Medium）の曲のアダプタ（ADR-0048 追記）。
 *
 * 応答の形（ジョブ・出来上がり・失敗の封筒）は効果音と同じなので `api.ts` を使う。
 * 違うのは、口が `MusicProvider` であること（歌詞と歌なしの指定を受け、送る前に断る）と、出来上がりが長いことだけ。
 *
 * **手元の GPU を使う**（`exclusiveResource: 'local-gpu'`）。効果音と同じ整理券に並ばせる。
 */

/** 出来上がり 1 曲を取り込む上限。190 秒・44.1kHz・PCM16 のステレオ WAV は約 34MB。 */
export const SFX_API_MUSIC_DOWNLOAD_TIMEOUT_MS = 180_000
/** 出来上がり 1 曲の上限。約 34MB なので、桁違いに大きいものは何かがおかしい。 */
export const SFX_API_MUSIC_MAX_OUTPUT_BYTES = 256 * 1024 * 1024

export type SfxApiMusicProviderOptions = {
  readonly baseUrl: string
  /** 未設定は null（空の Bearer を送らない）。 */
  readonly token: string | null
  /** 取り込んだ WAV を置く場所。 */
  readonly outputDir: string
  readonly fetch?: LocalServerFetch
  readonly timeoutMs?: number
  readonly downloadTimeoutMs?: number
}

const identity = SFX_API_MUSIC_IDENTITY
const invalidCode = localServerInvalidResponseCode(identity)
const jobPath = (jobId: string): string => `/v1/jobs/${encodeURIComponent(jobId)}`

/** 出来上がり 1 曲の置き場所。ジョブ ID は `LocalServerJobId` で検査済み（`../` を含まない）。 */
const outputName = (jobId: string, index: number): string => `music-${jobId}-${String(index)}`

const failed = (code: string, message: string, retryable: boolean): MusicJobStatusFromProvider => ({
  state: 'failed',
  error: { code, message, retryable },
})

const invalid = (message: string, status: number | null = null): LocalServerRequestError =>
  new LocalServerRequestError(identity.providerId, invalidCode, message, false, status)

/** 番号が 0 から欠けずに並んでいるか。欠けた成功を「成功」として返さない（頼んだ数との照合は呼ぶ側）。 */
const completeOutputs = (outputs: readonly SfxApiOutputInfo[], jobId: string): readonly SfxApiOutputInfo[] => {
  const sorted = [...outputs].sort((a, b) => a.index - b.index)
  if (!sorted.every((output, position) => output.index === position)) {
    throw invalid(`${identity.label}の出来上がりの番号が揃っていません（${jobId}）`)
  }
  return sorted
}

export const createSfxApiMusicProvider = (options: SfxApiMusicProviderOptions): MusicProvider => {
  const http: LocalServerHttp = {
    identity,
    fetch: options.fetch ?? globalThis.fetch,
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    token: options.token,
    timeoutMs: options.timeoutMs ?? SFX_API_REQUEST_TIMEOUT_MS,
  }
  const downloadHttp: LocalServerHttp = {
    ...http,
    timeoutMs: options.downloadTimeoutMs ?? SFX_API_MUSIC_DOWNLOAD_TIMEOUT_MS,
  }
  const { outputDir } = options

  const download = async (jobId: string, index: number): Promise<string> => {
    const existing = localServerOutputPath(outputDir, outputName(jobId, index), 'wav')
    if (await hasSavedOutput(existing)) return existing
    const { response } = await localServerOpen(
      downloadHttp,
      `${jobPath(jobId)}/output?index=${String(index)}`,
      'audio/wav',
    )
    if (!response.ok) {
      throw localServerErrorFor(identity, response.status, await readErrorBody(response), '出力の取得')
    }
    if (response.body === null) throw invalid(`${identity.label}の出力が空でした`, response.status)
    try {
      const saved = await saveOutputAtomically(
        outputDir,
        outputName(jobId, index),
        response.body,
        SFX_API_MUSIC_MAX_OUTPUT_BYTES,
        'wav',
      )
      return saved.path
    } catch (error) {
      // 本文の途中で切れた。向こうでは出来ているので、やり直せる失敗にする（効果音と同じ）。
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

  return {
    id: identity.providerId,
    models: [stableAudioMusicModel],
    exclusiveResource: 'local-gpu',

    async submit(request: MusicGenerationRequest): Promise<ProviderJobHandle> {
      ensureSfxApiMusicRequest(request)
      const key = idempotencyKeyOf(identity, request.idempotencyKey)

      const response = await localServerRequest(
        http,
        'POST',
        `/v1/workflows/${STABLE_AUDIO_MUSIC_WORKFLOW_ID}/jobs`,
        {
          // 前置き（TrackType・VocalType）はサーバが付ける。歌詞と歌なしの指定は送らない（検査で断っている）。
          prompt: request.prompt,
          duration_sec: request.durationSec,
          count: request.count,
          // 省略はサーバが毎回違う種を選ぶ。
          ...(request.seed === null ? {} : { seed: request.seed }),
        },
        key === null ? {} : { 'Idempotency-Key': key },
      )
      if (response.status === 429) {
        throw new ProviderBusyError(`${identity.label}が混んでいます`, identity.providerId, retryAfterMsFrom(response.headers))
      }
      const unavailable = response.status === 503 ? SfxApiUnavailableEnvelope.safeParse(response.body) : null
      if (unavailable?.success === true) {
        const reason = unavailable.data.error.message.trim()
        throw new LocalServerRequestError(
          identity.providerId,
          SFX_WORKFLOW_UNAVAILABLE_CODE,
          `${request.model.label}は今この Mac で使えません（${reason === '' ? '理由不明' : reasonOf(reason)}）。` +
            '「使う AI」で別の曲の AI を選ぶか、準備ができてから作り直してください。',
          false,
          response.status,
        )
      }
      if (!response.ok) throw localServerErrorFor(identity, response.status, response.body, '投入')

      const parsed = SfxApiSubmitResponse.safeParse(response.body)
      if (!parsed.success) throw invalid(`${identity.label}の投入応答が仕様と違います`, response.status)
      return {
        providerId: identity.providerId,
        modelId: request.model.id,
        ref: encodeLocalServerJobRef(identity, parsed.data.id),
        submittedAt: new Date(),
      }
    },

    async poll(handle: ProviderJobHandle): Promise<MusicJobStatusFromProvider> {
      const jobId = decodeLocalServerJobRef(identity, handle.ref)
      const response = await localServerRequest(http, 'GET', jobPath(jobId))
      if (!response.ok) throw localServerErrorFor(identity, response.status, response.body, '状態の取得')

      const parsed = SfxApiJob.safeParse(response.body)
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
            `${identity.label}で曲を作れませんでした: ${reasonOf(job.error?.message ?? '')}`,
            job.error?.retryable ?? false,
          )
        case 'canceled':
          return failed(`${identity.codePrefix}_canceled`, `${identity.label}で曲を作るのは取り消されました`, false)
        case 'succeeded': {
          const outputs = completeOutputs(job.result.outputs, job.id)
          const paths = await Promise.all(outputs.map((output) => download(job.id, output.index)))
          return {
            state: 'succeeded',
            outputs: outputs.map((output, position) => ({
              path: paths[position] ?? '',
              durationSec: output.duration_sec,
            })),
            // 1 曲目の種（i 曲目は seed + 2i。それぞれの種は raw に残す）。
            seedUsed: outputs[0]?.seed_used ?? null,
            // 手元の GPU。費用は掛からない。
            costUsd: 0,
            raw: {
              workflow: job.workflow,
              outputs: outputs.map(({ index, duration_sec, sample_rate, channels, seed_used }) => ({
                index,
                duration_sec,
                sample_rate,
                channels,
                seed_used,
              })),
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

    /** 取り込んだ WAV を消す。worker が楽曲として写したら要らない。 */
    async release(handle: ProviderJobHandle): Promise<void> {
      const jobId = decodeLocalServerJobRef(identity, handle.ref)
      await Promise.all(
        Array.from({ length: stableAudioMusicModel.maxCount }, (_, index) =>
          rm(localServerOutputPath(outputDir, outputName(jobId, index), 'wav'), { force: true }),
        ),
      )
    },
  }
}
