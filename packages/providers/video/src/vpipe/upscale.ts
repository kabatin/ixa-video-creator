import { ModelId, type Resolution } from '@ixa/domain'
import {
  ProviderBusyError,
  type ProviderJobHandle,
  type ProviderJobStatus,
  type VideoUpscaleRequest,
  type VideoUpscaleSubmission,
  type VideoUpscaler,
} from '@ixa/provider-core'
import { z } from 'zod'
import { LocalServerJob } from '../local-server/api.js'
import {
  LocalServerRequestError,
  localServerErrorFor,
  localServerOpen,
  localServerRequest,
  readErrorBody,
  reasonOf,
  retryAfterMsFrom,
  type LocalServerHttp,
} from '../local-server/http.js'
import { decodeLocalServerJobRef, encodeLocalServerJobRef } from '../local-server/job-ref.js'
import {
  hasSavedOutput,
  localServerOutputPath,
  saveOutputAtomically,
} from '../local-server/output.js'
import { idempotencyKeyOf } from '../local-server/submit.js'
import { VPIPE_IDENTITY } from './descriptor.js'

/**
 * 出来上がった Take の解像度を上げる（ADR-0044 / FlashVSR v1.1 を vpipe-api 越しに）。
 *
 * **生成（`createLocalServerVideoProvider`）とは入力が違う**ので別の口にしてある。
 * 渡すのは仕様ではなく、出来上がった動画そのもの。やりとりの作法（冪等キー・429・
 * エラー封筒・`/v1/jobs/{id}`）は同じなので、下回りは `local-server` の部品を使い回す。
 */

export const FLASHVSR_WORKFLOW_ID = 'flashvsr-upscale'
export const VPIPE_FLASHVSR_MODEL_ID: ModelId = ModelId.parse('vpipe/flashvsr-upscale')

/**
 * 掛かる時間の目安（押す前の下見だけに使う）。**走り出したらサーバの `estimate_seconds` が正。**
 *
 * 2026-10-09 に vpipe-api 側が M5 / 32GB で実測した値（見込みと実測の差は 1% 以内）。
 * FlashVSR は 25 コマの束から 21 コマを返すので、**費用はグループ数で決まる**。
 *
 * | 投入 | グループ | 実測 |
 * |---|---|---|
 * | 56 コマ | 3 | 312 秒 |
 * | 73 コマ | 4 | 413 秒 |
 * | 192 コマ | 10 | 1017 秒 |
 *
 * **「尺 × 係数」で出すと 2 倍外れる。** 22 コマ（0.91 秒）はコマが 1 枚 21 を超えただけで
 * 2 グループになり、線形なら 102 秒のところ実際は 207 秒掛かる。
 */
export const FLASHVSR_FRAMES_PER_GROUP = 21
export const FLASHVSR_SECONDS_PER_GROUP = 101
export const FLASHVSR_FIXED_SECONDS = 5

/** コマ数から見込み（秒）。**切り上げはグループ単位**。 */
export const flashvsrEstimateSec = (frames: number): number => {
  const groups = Math.ceil(Math.max(1, frames) / FLASHVSR_FRAMES_PER_GROUP)
  return FLASHVSR_FIXED_SECONDS + FLASHVSR_SECONDS_PER_GROUP * groups
}

/** `GET /v1/workflows` のうち、対応しているかを見るのに要る分だけ。 */
const WorkflowList = z.object({
  workflows: z.array(z.object({ id: z.string() })),
})

const jobPath = (jobId: string): string => `/v1/jobs/${encodeURIComponent(jobId)}`
const invalidCode = `${VPIPE_IDENTITY.codePrefix}_invalid_response`

export type VpipeUpscalerOptions = {
  readonly http: LocalServerHttp
  /** 取り込み前の動画を置く場所（生成と同じ `outputDir`）。 */
  readonly outputDir: string
}

export const createVpipeUpscaler = (options: VpipeUpscalerOptions): VideoUpscaler => {
  const { http, outputDir } = options
  const identity = VPIPE_IDENTITY

  const failed = (code: string, message: string, retryable: boolean): ProviderJobStatus => ({
    state: 'failed',
    error: { code, message, retryable },
  })

  const download = async (jobId: string): Promise<string> => {
    const { response } = await localServerOpen(http, `${jobPath(jobId)}/output`, 'video/mp4')
    if (!response.ok) {
      throw localServerErrorFor(identity, response.status, await readErrorBody(response), '出力の取得')
    }
    const body = response.body
    if (body === null) {
      throw new LocalServerRequestError(
        identity.providerId,
        invalidCode,
        `${identity.label}の出力が空でした`,
        false,
        response.status,
      )
    }
    const saved = await saveOutputAtomically(outputDir, jobId, body)
    return saved.path
  }

  return {
    providerId: identity.providerId,
    modelId: VPIPE_FLASHVSR_MODEL_ID,
    // 手元の GPU を使う。生成と順番を共有する（整理券。`local-gpu-lease.ts`）。
    exclusiveResource: 'local-gpu',

    /**
     * **サーバに訊く。** 対応していない版へ投げると、本文（最大 64MB）を送ってから断られる。
     * つながらないときは「対応していない」に倒す（押せないほうが、押して失敗するより良い）。
     */
    async available() {
      try {
        const response = await localServerRequest(http, 'GET', '/v1/workflows')
        if (!response.ok) return false
        const parsed = WorkflowList.safeParse(response.body)
        return parsed.success && parsed.data.workflows.some((w) => w.id === FLASHVSR_WORKFLOW_ID)
      } catch {
        return false
      }
    },

    async submit(request: VideoUpscaleRequest): Promise<VideoUpscaleSubmission> {
      const key = idempotencyKeyOf(identity, request.idempotencyKey)
      const output: Resolution = request.output
      const response = await localServerRequest(
        http,
        'POST',
        `/v1/workflows/${FLASHVSR_WORKFLOW_ID}/jobs`,
        {
          source_video: { data: request.video.data, media_type: request.video.mediaType },
          // **常に明示する。** サーバの既定に頼ると、版が変わったとき黙って違う大きさで返る。
          output: { width: output.width, height: output.height },
        },
        key === null ? {} : { 'Idempotency-Key': key },
      )

      if (response.status === 429) {
        throw new ProviderBusyError(
          `${identity.label}が混んでいます`,
          identity.providerId,
          retryAfterMsFrom(response.headers),
        )
      }
      if (!response.ok) {
        throw localServerErrorFor(identity, response.status, response.body, '投入')
      }

      const parsed = SubmitResponse.safeParse(response.body)
      if (!parsed.success) {
        throw new LocalServerRequestError(
          identity.providerId,
          invalidCode,
          `${identity.label}の投入応答が仕様と違います`,
          false,
          response.status,
        )
      }
      return {
        handle: {
          providerId: identity.providerId,
          modelId: VPIPE_FLASHVSR_MODEL_ID,
          ref: encodeLocalServerJobRef(identity, parsed.data.id),
          submittedAt: new Date(),
        },
        estimateSeconds: parsed.data.estimate_seconds ?? null,
      }
    },

    async poll(handle: ProviderJobHandle): Promise<ProviderJobStatus> {
      const jobId = decodeLocalServerJobRef(identity, handle.ref)
      /**
       * **HTTP の失敗は投げる（failed を返さない）。** 投げた `ProviderError` が retryable なら
       * worker は捨てずに問い合わせを予約し直す。サーバの再起動中に 1 回つながらなかっただけで
       * 走っている仕事を捨てない（生成の `poll` と同じ理由）。
       */
      const response = await localServerRequest(http, 'GET', jobPath(jobId))
      if (!response.ok) {
        throw localServerErrorFor(identity, response.status, response.body, '状態の取得')
      }

      const parsed = LocalServerJob.safeParse(response.body)
      if (!parsed.success) {
        // 形が違う応答を pending へ丸めない。終わらない仕事を回し続けることになる。
        return failed(invalidCode, `${identity.label}の状態応答が仕様と違います`, false)
      }
      const job = parsed.data
      if (job.id !== jobId) {
        return failed(
          invalidCode,
          `${identity.label}の状態応答が、問い合わせたのと別のジョブを指しています`,
          false,
        )
      }

      switch (job.status) {
        case 'queued':
          return { state: 'pending', progress: null }
        case 'running':
          return { state: 'running', progress: job.progress ?? null }
        case 'failed':
          return failed(
            `${identity.codePrefix}_${job.error?.code ?? 'upscale_failed'}`,
            `${identity.label}の解像度上げが失敗しました: ${reasonOf(job.error?.message ?? '')}`,
            job.error?.retryable ?? false,
          )
        case 'canceled':
          return failed(`${identity.codePrefix}_canceled`, `${identity.label}の解像度上げは取り消されました`, false)
        case 'succeeded': {
          const existing = localServerOutputPath(outputDir, job.id)
          const path = (await hasSavedOutput(existing)) ? existing : await download(job.id)
          return {
            state: 'succeeded',
            output: { type: 'local', path },
            // 解像度を上げるのに種は無い。手元の GPU なので費用も 0。
            seedUsed: null,
            costUsd: 0,
            raw: { workflow: FLASHVSR_WORKFLOW_ID, output: job.result.output },
          }
        }
      }
    },

    async cancel(handle: ProviderJobHandle): Promise<void> {
      const jobId = decodeLocalServerJobRef(identity, handle.ref)
      const response = await localServerRequest(http, 'DELETE', jobPath(jobId))
      // 409（もう終わっている）と 404（記録が無い）は「止める対象が無い」＝ 取消の契約としては成功。
      if (response.ok || response.status === 409 || response.status === 404) return
      throw localServerErrorFor(identity, response.status, response.body, '取消')
    },
  }
}

/** 投入の応答。見込み（`estimate_seconds`）は古い版では付かない。 */
const SubmitResponse = z.object({
  id: z.string().min(1),
  estimate_seconds: z.number().nonnegative().nullish(),
})
