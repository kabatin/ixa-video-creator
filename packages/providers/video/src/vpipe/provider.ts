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
import { formatIssues } from '../common/reason.js'
import { VpipeJob, type VpipeJobResult } from './api.js'
import {
  framesForDuration,
  VPIPE_DEFAULT_BASE_URL,
  VPIPE_MODEL_QUALITIES,
  VPIPE_POLL_POLICY,
  VPIPE_PROVIDER_ID,
  vpipeVideoModels,
  type VpipeQuality,
} from './descriptor.js'
import {
  readErrorBody,
  reasonOf,
  VPIPE_LABEL,
  vpipeCode,
  vpipeErrorFor,
  vpipeOpen,
  VpipeRequestError,
  vpipeRequest,
  type VpipeFetch,
  type VpipeHttp,
} from './http.js'
import { decodeVpipeJobRef, encodeVpipeJobRef } from './job-ref.js'
import {
  hasSavedOutput,
  pruneVpipeOutputs,
  saveOutputAtomically,
  vpipeOutputPath,
} from './output.js'
import {
  buildVpipeBody,
  fetchStartImage,
  selectStartReference,
  VPIPE_STEPS,
  type VpipeJobBody,
} from './request.js'
import { ensureCapacity, idempotencyKeyOf, postJob } from './submit.js'
import { readSubmitNote, writeSubmitNote, type VpipeSubmitNote } from './submit-note.js'

export type { VpipeFetch } from './http.js'

export const VpipeVideoProviderSettings = z.object({
  baseUrl: z
    .string()
    .url()
    .refine((url) => /^https?:\/\//i.test(url), 'http か https の URL にしてください')
    .default(VPIPE_DEFAULT_BASE_URL),
  /** 空文字は「未設定」。空の Bearer を送ると 401 の理由が分かりにくくなる。 */
  token: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? null : value)),
  /** 出来た動画・書きかけ・投入の控えを置く場所。worker が取り込んだあとは消えてよい。 */
  outputDir: z.string().min(1),
  /** 1 回の HTTP に掛ける上限。ハングしたサーバがキューを詰まらせないため必ず設定する。 */
  timeoutMs: z
    .number()
    .int()
    .positive()
    .default(60 * 1000),
})

export type VpipeVideoProviderOptions = {
  baseUrl?: string
  token?: string
  outputDir: string
  timeoutMs?: number
  /** テストから差し替える口。既定はグローバルの `fetch`。 */
  fetch?: VpipeFetch
}

const defaultFetch: VpipeFetch = (url, init) => fetch(url, init)

type FailedStatus = Extract<ProviderJobStatus, { state: 'failed' }>
type SucceededStatus = Extract<ProviderJobStatus, { state: 'succeeded' }>

const failed = (code: string, message: string, retryable: boolean): FailedStatus => ({
  state: 'failed',
  error: { code, message, retryable },
})

/** モデルと生成の段を同時に引く。片方だけ解決できる状態を作らない。 */
const resolveModel = (
  modelId: ModelId,
): { readonly model: VideoModelDescriptor; readonly quality: VpipeQuality } => {
  const model = vpipeVideoModels.find((candidate) => candidate.id === modelId)
  const quality = VPIPE_MODEL_QUALITIES[modelId]
  if (model === undefined || quality === undefined) {
    throw new ProviderError(
      `vpipe アダプタは未知のモデル ${modelId} を扱えません`,
      VPIPE_PROVIDER_ID,
      false,
    )
  }
  return { model, quality }
}

const jobPath = (jobId: string): string => `/v1/jobs/${encodeURIComponent(jobId)}`

const secondsBetween = (from: string | null, to: string | null): number | null => {
  if (from === null || to === null) return null
  const ms = Date.parse(to) - Date.parse(from)
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null
}

/**
 * vpipe-api（手元の MiniMax H3 Turbo）のアダプタ（ADR-0030）。
 *
 * - SDK を足さず素の `fetch` で書く。`fetch` は**引数で受ける**ので、契約テストはモック応答だけで完結する
 * - `process.env` はここから読まない。設定は `packages/config` が読んで配線が渡す
 * - 満杯（429）は `ProviderBusyError` で知らせる。worker はジョブを失敗にせず、時間を置いて投入し直す
 * - 出力はサーバから取り寄せて `{ type: 'local', path }` で返す（`output.ts` の理由）
 */
export const createVpipeVideoProvider = (options: VpipeVideoProviderOptions): VideoProvider => {
  const settings = VpipeVideoProviderSettings.parse({
    outputDir: options.outputDir,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.token === undefined ? {} : { token: options.token }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
  const { outputDir, timeoutMs } = settings

  const http: VpipeHttp = {
    fetch: options.fetch ?? defaultFetch,
    baseUrl: settings.baseUrl.replace(/\/+$/, ''),
    token: settings.token,
    timeoutMs,
  }

  const submit = async (request: VideoGenerationRequest): Promise<ProviderJobHandle> => {
    const { model, quality } = resolveModel(request.model.id)
    const violations = validateAgainstCapabilities(request.spec, model)
    if (violations.length > 0) throw new CapabilityViolationError(model.id, violations)
    const idempotencyKey = idempotencyKeyOf(request.idempotencyKey)

    // 古い出力の掃除。**投げない**ので、掃除の失敗で投入を止めることはない。
    await pruneVpipeOutputs(outputDir)

    const frames = framesForDuration(
      quantizeDuration(request.spec.durationSec, model.capabilities.durations),
    )
    // 画像より先に本文を組んで確かめる（プロンプトの長さなどで落ちるなら、画像を取り寄せる前に落とす）。
    const bodyWithoutImage = buildVpipeBody({
      spec: request.spec,
      quality,
      frames,
      startImage: null,
    })
    const { chosen, ignored } = selectStartReference(request.spec.references)

    // 満杯なら、開始画像を取り寄せる前に断る（`ProviderBusyError`）。
    await ensureCapacity(http)

    const startImage =
      chosen === null
        ? null
        : await fetchStartImage(
            http.fetch,
            await request.resolveReference(chosen.mediaAssetId),
            timeoutMs,
          )
    const body: VpipeJobBody = { ...bodyWithoutImage, start_image: startImage }
    const jobId = await postJob(http, body, idempotencyKey)

    const ref = encodeVpipeJobRef(jobId)
    const note: VpipeSubmitNote = {
      startImage:
        chosen === null || startImage === null
          ? null
          : {
              role: chosen.role,
              mediaAssetId: chosen.mediaAssetId,
              mediaType: startImage.media_type,
            },
      ignoredReferences: ignored.map((reference) => ({
        role: reference.role,
        mediaAssetId: reference.mediaAssetId,
      })),
    }
    await writeSubmitNote(outputDir, ref, note)

    return { providerId: VPIPE_PROVIDER_ID, modelId: model.id, ref, submittedAt: new Date() }
  }

  /** サーバから出力を取り寄せ、書き終えたファイルのパスを返す。 */
  const download = async (jobId: string): Promise<string> => {
    const { response } = await vpipeOpen(http, `${jobPath(jobId)}/output`, 'video/mp4')
    if (!response.ok) {
      throw vpipeErrorFor(response.status, await readErrorBody(response), '出力の取得')
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
    if (contentType !== '' && contentType.toLowerCase() !== 'video/mp4') {
      await response.body?.cancel()
      throw new VpipeRequestError(
        'vpipe_invalid_response',
        `${VPIPE_LABEL}の出力が動画（mp4）ではありません`,
        false,
        response.status,
      )
    }

    const body: ReadableStream<Uint8Array> | null = response.body
    if (body === null) {
      throw new VpipeRequestError(
        'vpipe_output_unsaved',
        `${VPIPE_LABEL}の出力が空でした`,
        true,
        response.status,
      )
    }

    try {
      return (await saveOutputAtomically(outputDir, jobId, body)).path
    } catch (cause) {
      // 途中で切れた・書けなかった。出力はサーバに残っているので、次の問い合わせで取り直せる。
      throw new VpipeRequestError(
        'vpipe_output_unsaved',
        `${VPIPE_LABEL}の出力を手元に保存できませんでした`,
        true,
        null,
        { cause },
      )
    }
  }

  /** 完了したジョブを Take に残せる形へ落とす。**同じジョブを 2 度取り寄せない。** */
  const complete = async (
    model: VideoModelDescriptor,
    quality: VpipeQuality,
    job: Extract<VpipeJob, { status: 'succeeded' }>,
  ): Promise<SucceededStatus> => {
    const existing = vpipeOutputPath(outputDir, job.id)
    const path = (await hasSavedOutput(existing)) ? existing : await download(job.id)
    const note = await readSubmitNote(outputDir, job.id)
    return {
      state: 'succeeded',
      output: { type: 'local', path },
      ...recordOf(model, quality, job, note),
    }
  }

  const poll = async (handle: ProviderJobHandle): Promise<ProviderJobStatus> => {
    const { model, quality } = resolveModel(handle.modelId)
    const jobId = decodeVpipeJobRef(handle.ref)

    /**
     * **HTTP の失敗は投げる（failed を返さない）。** 投げた `ProviderError` が retryable なら
     * worker は捨てずに問い合わせを予約し直す。failed を返すと終端になり、
     * サーバの再起動中に 1 回つながらなかっただけで、走っている生成を捨てることになる。
     */
    const response = await vpipeRequest(http, 'GET', jobPath(jobId))
    if (!response.ok) throw vpipeErrorFor(response.status, response.body, '状態の取得')

    const parsed = VpipeJob.safeParse(response.body)
    if (!parsed.success) {
      // 形が違う応答を pending へ丸めない。終わらないジョブを回し続けることになる。
      return failed(
        'vpipe_invalid_response',
        `${VPIPE_LABEL}の状態応答が仕様と違います: ${formatIssues(parsed.error)}`,
        false,
      )
    }

    const job = parsed.data
    if (job.id !== jobId) {
      // 別のジョブの応答を自分のものとして取り込まない（出力のファイル名もジョブ ID で決まる）。
      return failed(
        'vpipe_invalid_response',
        `${VPIPE_LABEL}の状態応答が、問い合わせたのと別のジョブを指しています`,
        false,
      )
    }
    switch (job.status) {
      case 'queued':
        // `queue_position` は待ち順であって進み具合ではない。progress にしない。
        return { state: 'pending', progress: null }
      case 'running':
        return { state: 'running', progress: job.progress ?? null }
      case 'failed':
        // 理由は必ず載せる（空にしない）。やり直せるかはサーバの判断に従う。
        return failed(
          vpipeCode(job.error?.code ?? 'generation_failed'),
          `${VPIPE_LABEL}が失敗しました: ${reasonOf(job.error?.message ?? '')}`,
          job.error?.retryable ?? false,
        )
      case 'canceled':
        return failed('vpipe_canceled', `${VPIPE_LABEL}の生成は取り消されました`, false)
      case 'succeeded':
        return complete(model, quality, job)
    }
  }

  const cancel = async (handle: ProviderJobHandle): Promise<void> => {
    resolveModel(handle.modelId)
    const jobId = decodeVpipeJobRef(handle.ref)
    const response = await vpipeRequest(http, 'DELETE', jobPath(jobId))

    // 409（もう終わっている）と 404（記録が無い）は「止める対象が無い」であり、cancel の契約からすれば成功。
    if (response.ok || response.status === 409 || response.status === 404) return
    throw vpipeErrorFor(response.status, response.body, '取消')
  }

  return {
    id: VPIPE_PROVIDER_ID,
    models: vpipeVideoModels,
    // 手元のサーバなので細かく問い合わせる（30 秒おき・約 3 時間。descriptor.ts）。
    pollPolicy: VPIPE_POLL_POLICY,
    submit,
    poll,
    cancel,
  }
}

/**
 * `Take.providerParams` に残る記録。**URL・トークン・画像の中身は 1 つも入れない**（規約 7）。
 * 送った本文は `Take.spec` から組み直せる（`buildVpipeBody` は仕様の純関数）ので、
 * ここには組み直しでは分からないこと（サーバの実測・実際に使った参照）だけを残す。
 */
const recordOf = (
  model: VideoModelDescriptor,
  quality: VpipeQuality,
  job: Extract<VpipeJob, { status: 'succeeded' }>,
  note: VpipeSubmitNote | null,
): Omit<SucceededStatus, 'state' | 'output'> => {
  const result: VpipeJobResult = job.result
  const { output } = result
  return {
    seedUsed: result.seed_used,
    // 手元の GPU で動くので実際にかかった額は 0。スタブの 0 とは意味が違う（ADR-0025 / 0030）。
    costUsd: 0,
    raw: {
      provider: VPIPE_PROVIDER_ID,
      modelId: model.id,
      workflow: job.workflow,
      jobId: job.id,
      quality,
      steps: VPIPE_STEPS,
      costPerSecondUsd: model.economics.costPerSecondUsd,
      output: {
        mediaType: output.media_type,
        width: output.width,
        height: output.height,
        frames: output.frames,
        fps: output.fps,
        durationSec: output.duration_sec,
      },
      /** サーバが実際に生成した大きさ（出力はこれを拡大したもの）。 */
      generation: result.details?.generation ?? null,
      /** vpipe-api は音を捨てる。出力に音声トラックは無い。 */
      audio: false,
      renderSec: secondsBetween(job.started_at, job.finished_at),
      /** 投入時の控え。null は「控えが読めず分からない」（推測で埋めない）。 */
      startImage: note === null ? null : note.startImage,
      ignoredReferences: note === null ? null : note.ignoredReferences,
    },
  }
}
