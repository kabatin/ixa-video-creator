import type { ModelId, ShotGenerationSpec } from '@ixa/domain'
import {
  CapabilityViolationError,
  ProviderError,
  validateAgainstCapabilities,
  type PollPolicy,
  type ProviderJobHandle,
  type ProviderJobStatus,
  type VideoGenerationRequest,
  type VideoModelDescriptor,
  type VideoProvider,
} from '@ixa/provider-core'
import { z } from 'zod'
import { formatIssues } from '../common/reason.js'
import { LocalServerJob, type LocalServerJobResult } from './api.js'
import {
  localServerCode,
  localServerInvalidResponseCode,
  type LocalServerIdentity,
} from './identity.js'
import {
  localServerErrorFor,
  localServerOpen,
  localServerRequest,
  LocalServerRequestError,
  readErrorBody,
  reasonOf,
  type LocalServerFetch,
  type LocalServerHttp,
} from './http.js'
import { decodeLocalServerJobRef, encodeLocalServerJobRef } from './job-ref.js'
import {
  hasSavedOutput,
  IGNORE_LOCAL_SERVER_WARNING,
  localServerOutputPath,
  LOCAL_SERVER_OUTPUT_RETENTION_MS,
  pruneLocalServerOutputs,
  saveOutputAtomically,
  type LocalServerWarn,
} from './output.js'
import {
  ensurePromptAndSeed,
  fetchStartImage,
  selectStartReference,
  type LocalServerImage,
} from './request.js'
import {
  ensureCapacity,
  idempotencyKeyOf,
  LOCAL_SERVER_HEALTH_TIMEOUT_MS,
  LOCAL_SERVER_SERVER_ERROR_RETRY_MS,
  postJob,
} from './submit.js'
import { readSubmitNote, writeSubmitNote, type LocalServerSubmitNote } from './submit-note.js'

/**
 * 手元の生成サーバ（vpipe-api v1 契約）のアダプタ（ADR-0031 / 0040）。
 *
 * **1 台分の違いは `LocalServerIdentity` と `LocalServerBinding` に閉じる。**
 * MiniMax H3（vpipe-api）と Wan 2.2（wan-api）はどちらもこの実装を使う。サーバが増えても、
 * 増えるのはモデルの宣言と投入の本文の組み立てだけになる。
 *
 * - SDK を足さず素の `fetch` で書く。`fetch` は**引数で受ける**ので、契約テストはモック応答だけで完結する
 * - `process.env` はここから読まない。設定は `packages/config` が読んで配線が渡す
 * - 満杯（429）は `ProviderBusyError` で知らせる。worker はジョブを失敗にせず、時間を置いて投入し直す
 * - 出力はサーバから取り寄せて `{ type: 'local', path }` で返す（`output.ts` の理由）
 */

/** 生成の段。サーバがこれをモデルの実行設定（解像度・ステップ数・LoRA・量子化）へ訳す。 */
export type LocalServerQualityTier = 'draft' | 'standard'

export type LocalServerBodyInput<Q extends string> = {
  readonly spec: ShotGenerationSpec
  readonly model: VideoModelDescriptor
  readonly quality: Q
  /**
   * 共通の層が `start_image` を足すか。**本文は画像を取り寄せる前に組む**ので、画像そのものは渡せない。
   * それでもプロンプトは「開始画像があるか」で変わる（H3 の 1 行目。ADR-0042）ので、これで伝える。
   * 以前はこれが無く、H3 は開始画像を送っていても「画像なし」の文面で組んでいた（h3-official-v1）。
   */
  readonly hasStartImage: boolean
}

/** サーバ 1 台分のモデルの宣言と、投入の本文の組み立て。 */
export type LocalServerBinding<Q extends string> = {
  readonly models: readonly VideoModelDescriptor[]
  /**
   * モデル ID から生成の段を引く。**ID の文字列から導かない**（fal の `FAL_MODEL_PATHS` と同じ理由）。
   */
  readonly qualities: Readonly<Record<string, Q>>
  readonly pollPolicy: PollPolicy
  /**
   * 仕様から投入の本文を組む**純関数**。`start_image` は含めない（共通の層が足す）。
   * 画像の取得もしない（取得は `fetchStartImage`）。
   */
  readonly buildBody: (input: LocalServerBodyInput<Q>) => object
  /**
   * Take の記録に足す、そのサーバだけの項目（明示して送った設定など）。
   * **送った本文は `Take.spec` から組み直せる**ので、組み直しで分からないものだけを足す。
   */
  readonly extraRecord?: (input: {
    readonly model: VideoModelDescriptor
    readonly quality: Q
  }) => Record<string, unknown>
}

export const LocalServerProviderSettings = z.object({
  baseUrl: z
    .string()
    .url()
    .refine((url) => /^https?:\/\//i.test(url), 'http か https の URL にしてください'),
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
  /** 投入前の空きの確認に掛ける上限。答えないサーバで同じキューの生成を待たせない。 */
  healthTimeoutMs: z.number().int().positive().default(LOCAL_SERVER_HEALTH_TIMEOUT_MS),
  /** サーバのエラー（5xx）で投げ直すまでの間（回を重ねるごとに伸ばす）。 */
  serverErrorRetryDelayMs: z.number().int().nonnegative().default(LOCAL_SERVER_SERVER_ERROR_RETRY_MS),
})

export type LocalServerProviderOptions = {
  baseUrl: string
  token?: string
  outputDir: string
  timeoutMs?: number
  healthTimeoutMs?: number
  serverErrorRetryDelayMs?: number
  /** テストから差し替える口。既定はグローバルの `fetch`。 */
  fetch?: LocalServerFetch
  /** 生成は止めないが黙って捨てない失敗（掃除・控え）を知らせる口。配線は logger の warn を渡す。 */
  warn?: LocalServerWarn
}

const defaultFetch: LocalServerFetch = (url, init) => fetch(url, init)

type FailedStatus = Extract<ProviderJobStatus, { state: 'failed' }>
type SucceededStatus = Extract<ProviderJobStatus, { state: 'succeeded' }>

const jobPath = (jobId: string): string => `/v1/jobs/${encodeURIComponent(jobId)}`

const secondsBetween = (from: string | null, to: string | null): number | null => {
  if (from === null || to === null) return null
  const ms = Date.parse(to) - Date.parse(from)
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null
}

export const createLocalServerVideoProvider = <Q extends string>(
  identity: LocalServerIdentity,
  binding: LocalServerBinding<Q>,
  options: LocalServerProviderOptions,
): VideoProvider => {
  const settings = LocalServerProviderSettings.parse({
    baseUrl: options.baseUrl,
    outputDir: options.outputDir,
    ...(options.token === undefined ? {} : { token: options.token }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.healthTimeoutMs === undefined ? {} : { healthTimeoutMs: options.healthTimeoutMs }),
    ...(options.serverErrorRetryDelayMs === undefined
      ? {}
      : { serverErrorRetryDelayMs: options.serverErrorRetryDelayMs }),
  })
  const { outputDir, timeoutMs } = settings
  const warn = options.warn ?? IGNORE_LOCAL_SERVER_WARNING

  const http: LocalServerHttp = {
    identity,
    fetch: options.fetch ?? defaultFetch,
    baseUrl: settings.baseUrl.replace(/\/+$/, ''),
    token: settings.token,
    timeoutMs,
  }

  const failed = (code: string, message: string, retryable: boolean): FailedStatus => ({
    state: 'failed',
    error: { code, message, retryable },
  })

  /** モデルと生成の段を同時に引く。片方だけ解決できる状態を作らない。 */
  const resolveModel = (
    modelId: ModelId,
  ): { readonly model: VideoModelDescriptor; readonly quality: Q } => {
    const model = binding.models.find((candidate) => candidate.id === modelId)
    const quality = binding.qualities[modelId]
    if (model === undefined || quality === undefined) {
      throw new ProviderError(
        `${identity.providerId} アダプタは未知のモデル ${modelId} を扱えません`,
        identity.providerId,
        false,
      )
    }
    return { model, quality }
  }

  const submit = async (request: VideoGenerationRequest): Promise<ProviderJobHandle> => {
    const { model, quality } = resolveModel(request.model.id)
    const violations = validateAgainstCapabilities(request.spec, model)
    if (violations.length > 0) throw new CapabilityViolationError(model.id, violations)
    const idempotencyKey = idempotencyKeyOf(identity, request.idempotencyKey)

    // 古い出力の掃除。**投げない**ので、掃除の失敗で投入を止めることはない。
    await pruneLocalServerOutputs(outputDir, Date.now(), LOCAL_SERVER_OUTPUT_RETENTION_MS, warn)

    // 画像より先に本文を組んで確かめる（プロンプトの長さなどで落ちるなら、画像を取り寄せる前に落とす）。
    ensurePromptAndSeed(identity, request.spec)
    // **どの画像を使うかを先に決める。** 文面が「開始画像があるか」で変わるので、本文より先に要る。
    const { chosen, ignored } = selectStartReference(request.spec.references)
    const bodyWithoutImage = binding.buildBody({
      spec: request.spec,
      model,
      quality,
      hasStartImage: chosen !== null,
    })

    // 満杯なら、開始画像を取り寄せる前に断る（`ProviderBusyError`）。
    await ensureCapacity(http, settings.healthTimeoutMs)

    const startImage: LocalServerImage | null =
      chosen === null
        ? null
        : await fetchStartImage(
            identity,
            http.fetch,
            await request.resolveReference(chosen.mediaAssetId),
            timeoutMs,
          )
    const body = { ...bodyWithoutImage, start_image: startImage }
    const jobId = await postJob(http, body, idempotencyKey, settings.serverErrorRetryDelayMs)

    const ref = encodeLocalServerJobRef(identity, jobId)
    const note: LocalServerSubmitNote = {
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
    await writeSubmitNote(outputDir, ref, note, warn)

    return { providerId: identity.providerId, modelId: model.id, ref, submittedAt: new Date() }
  }

  /** サーバから出力を取り寄せ、書き終えたファイルのパスを返す。 */
  const download = async (jobId: string): Promise<string> => {
    const { response } = await localServerOpen(http, `${jobPath(jobId)}/output`, 'video/mp4')
    if (!response.ok) {
      throw localServerErrorFor(identity, response.status, await readErrorBody(response), '出力の取得')
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
    if (contentType !== '' && contentType.toLowerCase() !== 'video/mp4') {
      await response.body?.cancel()
      throw new LocalServerRequestError(
        identity.providerId,
        localServerInvalidResponseCode(identity),
        `${identity.label}の出力が動画（mp4）ではありません`,
        false,
        response.status,
      )
    }

    const body: ReadableStream<Uint8Array> | null = response.body
    if (body === null) {
      throw new LocalServerRequestError(
        identity.providerId,
        `${identity.codePrefix}_output_unsaved`,
        `${identity.label}の出力が空でした`,
        true,
        response.status,
      )
    }

    try {
      return (await saveOutputAtomically(outputDir, jobId, body)).path
    } catch (cause) {
      // 途中で切れた・書けなかった。出力はサーバに残っているので、次の問い合わせで取り直せる。
      throw new LocalServerRequestError(
        identity.providerId,
        `${identity.codePrefix}_output_unsaved`,
        `${identity.label}の出力を手元に保存できませんでした`,
        true,
        null,
        { cause },
      )
    }
  }

  /** 完了したジョブを Take に残せる形へ落とす。**同じジョブを 2 度取り寄せない。** */
  const complete = async (
    model: VideoModelDescriptor,
    quality: Q,
    job: Extract<LocalServerJob, { status: 'succeeded' }>,
  ): Promise<SucceededStatus> => {
    const existing = localServerOutputPath(outputDir, job.id)
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
    const jobId = decodeLocalServerJobRef(identity, handle.ref)

    /**
     * **HTTP の失敗は投げる（failed を返さない）。** 投げた `ProviderError` が retryable なら
     * worker は捨てずに問い合わせを予約し直す。failed を返すと終端になり、
     * サーバの再起動中に 1 回つながらなかっただけで、走っている生成を捨てることになる。
     */
    const response = await localServerRequest(http, 'GET', jobPath(jobId))
    if (!response.ok) throw localServerErrorFor(identity, response.status, response.body, '状態の取得')

    const parsed = LocalServerJob.safeParse(response.body)
    if (!parsed.success) {
      // 形が違う応答を pending へ丸めない。終わらないジョブを回し続けることになる。
      return failed(
        localServerInvalidResponseCode(identity),
        `${identity.label}の状態応答が仕様と違います: ${formatIssues(parsed.error)}`,
        false,
      )
    }

    const job = parsed.data
    if (job.id !== jobId) {
      // 別のジョブの応答を自分のものとして取り込まない（出力のファイル名もジョブ ID で決まる）。
      return failed(
        localServerInvalidResponseCode(identity),
        `${identity.label}の状態応答が、問い合わせたのと別のジョブを指しています`,
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
          localServerCode(identity, job.error?.code ?? 'generation_failed'),
          `${identity.label}が失敗しました: ${reasonOf(job.error?.message ?? '')}`,
          job.error?.retryable ?? false,
        )
      case 'canceled':
        return failed(
          `${identity.codePrefix}_canceled`,
          `${identity.label}の生成は取り消されました`,
          false,
        )
      case 'succeeded':
        return complete(model, quality, job)
    }
  }

  const cancel = async (handle: ProviderJobHandle): Promise<void> => {
    resolveModel(handle.modelId)
    const jobId = decodeLocalServerJobRef(identity, handle.ref)
    const response = await localServerRequest(http, 'DELETE', jobPath(jobId))

    // 409（もう終わっている）と 404（記録が無い）は「止める対象が無い」であり、cancel の契約からすれば成功。
    if (response.ok || response.status === 409 || response.status === 404) return
    throw localServerErrorFor(identity, response.status, response.body, '取消')
  }

  /**
   * `Take.providerParams` に残る記録。**URL・トークン・画像の中身は 1 つも入れない**（規約 7）。
   * 送った本文は `Take.spec` から組み直せる（`buildBody` は仕様の純関数）ので、
   * ここには組み直しでは分からないこと（サーバの実測・実際に使った参照）だけを残す。
   */
  const recordOf = (
    model: VideoModelDescriptor,
    quality: Q,
    job: Extract<LocalServerJob, { status: 'succeeded' }>,
    note: LocalServerSubmitNote | null,
  ): Omit<SucceededStatus, 'state' | 'output'> => {
    const result: LocalServerJobResult = job.result
    const { output } = result
    return {
      seedUsed: result.seed_used,
      // 手元の GPU で動くので実際にかかった額は 0。スタブの 0 とは意味が違う（ADR-0025 / 0030）。
      costUsd: 0,
      raw: {
        provider: identity.providerId,
        modelId: model.id,
        workflow: job.workflow,
        jobId: job.id,
        quality,
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
        /** 手元の生成サーバは音を捨てる。出力に音声トラックは無い。 */
        audio: false,
        /**
         * 生成そのものに掛かった時間（送った後の順番待ちを含めない）。
         * **サーバが測った値を正とし**（wan-api の `timings`）、返さないサーバでは時刻の差から出す。
         * 時刻の差は問い合わせの間隔（30 秒おき）の分だけ長く出るので、あくまで代わりの値。
         */
        renderSec:
          job.timings?.backend_seconds ?? secondsBetween(job.started_at, job.finished_at),
        /** サーバの中で順番を待った時間（ADR-0040 の計測）。 */
        queuedSec: job.timings?.queue_seconds ?? secondsBetween(job.created_at, job.started_at),
        /** サーバが測った各段の秒数。返さないサーバでは null。 */
        timings: job.timings ?? null,
        /** 投入時の控え。null は「控えが読めず分からない」（推測で埋めない）。 */
        startImage: note === null ? null : note.startImage,
        ignoredReferences: note === null ? null : note.ignoredReferences,
        ...(binding.extraRecord === undefined ? {} : binding.extraRecord({ model, quality })),
      },
    }
  }

  return {
    id: identity.providerId,
    models: binding.models,
    // 手元のサーバなので細かく問い合わせる（30 秒おき・約 3 時間）。
    pollPolicy: binding.pollPolicy,
    /** この機械の GPU（Metal）を使う。worker が 1 本ずつに揃える（ADR-0040）。 */
    exclusiveResource: 'local-gpu',
    submit,
    poll,
    cancel,
  }
}
