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
import { AceStepJob, AceStepSubmitResponse, type AceStepOutputInfo } from './api.js'
import { ACE_STEP_IDENTITY, ACE_STEP_WORKFLOW_ID, aceStepMusicModel } from './descriptor.js'
import { ensureAceStepRequest } from './request.js'

/**
 * ace-step-api（ACE-Step 1.5）の曲のアダプタ（ADR-0048）。
 *
 * やりとりの作法（冪等キー・429・失敗の封筒・`/v1/jobs/{id}`）は klein-api と同じなので、
 * 下回りは動画の `local-server/` の部品を使う。違うのは本文と、出来上がりが**複数曲の WAV** であることだけ。
 *
 * **手元の GPU を使う**（`exclusiveResource: 'local-gpu'`）。worker は動画・絵と同じ整理券に並ばせる。
 */

/** 1 回の HTTP の上限。投入の本文は歌詞だけなので小さい。 */
export const ACE_STEP_REQUEST_TIMEOUT_MS = 30_000
/** 出来上がり 1 曲を取り込む上限。240 秒のステレオ WAV は 40〜90MB。 */
export const ACE_STEP_DOWNLOAD_TIMEOUT_MS = 180_000
/** 出来上がり 1 曲の上限。240 秒・48kHz・32bit のステレオでも 100MB に届かない。 */
export const ACE_STEP_MAX_OUTPUT_BYTES = 256 * 1024 * 1024

export type AceStepMusicProviderOptions = {
  readonly baseUrl: string
  /** 未設定は null（空の Bearer を送らない）。 */
  readonly token: string | null
  /** 取り込んだ WAV を置く場所。 */
  readonly outputDir: string
  readonly fetch?: LocalServerFetch
  readonly timeoutMs?: number
  readonly downloadTimeoutMs?: number
}

const identity = ACE_STEP_IDENTITY
const invalidCode = localServerInvalidResponseCode(identity)
const jobPath = (jobId: string): string => `/v1/jobs/${encodeURIComponent(jobId)}`

/** 出来上がり 1 曲の置き場所。ジョブ ID は `LocalServerJobId` で検査済み（`../` を含まない）。 */
const outputName = (jobId: string, index: number): string => `${jobId}-${String(index)}`

const failed = (code: string, message: string, retryable: boolean): MusicJobStatusFromProvider => ({
  state: 'failed',
  error: { code, message, retryable },
})

/** 番号が 0 から欠けずに並んでいるか。欠けた成功を「成功」として返さない（頼んだ数との照合は呼ぶ側）。 */
const completeOutputs = (outputs: readonly AceStepOutputInfo[], jobId: string): readonly AceStepOutputInfo[] => {
  const sorted = [...outputs].sort((a, b) => a.index - b.index)
  if (!sorted.every((output, position) => output.index === position)) {
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

export const createAceStepMusicProvider = (options: AceStepMusicProviderOptions): MusicProvider => {
  const http: LocalServerHttp = {
    identity,
    fetch: options.fetch ?? globalThis.fetch,
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    token: options.token,
    timeoutMs: options.timeoutMs ?? ACE_STEP_REQUEST_TIMEOUT_MS,
  }
  const downloadHttp: LocalServerHttp = {
    ...http,
    timeoutMs: options.downloadTimeoutMs ?? ACE_STEP_DOWNLOAD_TIMEOUT_MS,
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
    if (response.body === null) {
      throw new LocalServerRequestError(identity.providerId, invalidCode, `${identity.label}の出力が空でした`, false, response.status)
    }
    try {
      const saved = await saveOutputAtomically(
        outputDir,
        outputName(jobId, index),
        response.body,
        ACE_STEP_MAX_OUTPUT_BYTES,
        'wav',
      )
      return saved.path
    } catch (error) {
      // 本文の途中で切れた。向こうでは出来ているので、やり直せる失敗にする（klein と同じ）。
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
    models: [aceStepMusicModel],
    exclusiveResource: 'local-gpu',

    async submit(request: MusicGenerationRequest): Promise<ProviderJobHandle> {
      ensureAceStepRequest(request)
      const key = idempotencyKeyOf(identity, request.idempotencyKey)

      const response = await localServerRequest(
        http,
        'POST',
        `/v1/workflows/${ACE_STEP_WORKFLOW_ID}/jobs`,
        {
          prompt: request.prompt,
          // 歌なしなら歌詞は送らない（サーバも無視するが、要らない文を流さない）。
          lyrics: request.instrumental ? '' : request.lyrics,
          duration_sec: request.durationSec,
          instrumental: request.instrumental,
          // 省略はサーバが毎回違う種を選ぶ。
          ...(request.seed === null ? {} : { seed: request.seed }),
          count: request.count,
        },
        key === null ? {} : { 'Idempotency-Key': key },
      )
      if (response.status === 429) {
        throw new ProviderBusyError(`${identity.label}が混んでいます`, identity.providerId, retryAfterMsFrom(response.headers))
      }
      if (!response.ok) throw localServerErrorFor(identity, response.status, response.body, '投入')

      const parsed = AceStepSubmitResponse.safeParse(response.body)
      if (!parsed.success) {
        throw new LocalServerRequestError(identity.providerId, invalidCode, `${identity.label}の投入応答が仕様と違います`, false, response.status)
      }
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

      const parsed = AceStepJob.safeParse(response.body)
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
            seedUsed: job.result.seed_used,
            // 手元の GPU。費用は掛からない。
            costUsd: 0,
            raw: {
              workflow: ACE_STEP_WORKFLOW_ID,
              outputs: outputs.map(({ index, duration_sec, seed_used }) => ({ index, duration_sec, seed_used })),
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

    /** 取り込んだ WAV を消す。worker が素材として写したら要らない。 */
    async release(handle: ProviderJobHandle): Promise<void> {
      const jobId = decodeLocalServerJobRef(identity, handle.ref)
      await Promise.all(
        Array.from({ length: aceStepMusicModel.maxCount }, (_, index) =>
          rm(localServerOutputPath(outputDir, outputName(jobId, index), 'wav'), { force: true }),
        ),
      )
    },
  }
}
