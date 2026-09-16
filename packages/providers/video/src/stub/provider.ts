import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeSpecHash, quantizeDuration } from '@ixa/domain'
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
import { colorForShot } from './color.js'
import { STUB_PROVIDER_ID, stubVideoModels } from './descriptor.js'
import { placeholderLines } from './lines.js'
import { renderPlaceholder } from './render-placeholder.js'

export const StubProviderOptions = z.object({
  /** 生成物の出力先。存在しなければ submit 時に作成する。 */
  outputDir: z.string().min(1),
  /** ポーリングの挙動を試すための擬似レイテンシ。既定 0。 */
  simulatedLatencyMs: z.number().int().nonnegative().default(0),
})
export type StubProviderOptions = {
  outputDir: string
  simulatedLatencyMs?: number
}

type StubJob = {
  readonly handle: ProviderJobHandle
  readonly controller: AbortController
  readonly outputPath: string
  readonly status: ProviderJobStatus
  /** cancel 後に ffmpeg の失敗で状態を上書きしないためのフラグ。 */
  readonly cancelled: boolean
}

const CANCELLED: ProviderJobStatus = {
  state: 'failed',
  error: { code: 'cancelled', message: 'ジョブはキャンセルされました', retryable: false },
}

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('待機中に中断されました', { cause: signal.reason }))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })

const unknownJobError = (ref: string): ProviderError =>
  new ProviderError(`未知のジョブ ${ref} です`, STUB_PROVIDER_ID, false)

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const resolveModel = (model: VideoModelDescriptor): VideoModelDescriptor => {
  const known = stubVideoModels.find((candidate) => candidate.id === model.id)
  if (known === undefined) {
    throw new ProviderError(
      `スタブ Provider は未知のモデル ${model.id} を扱えません`,
      STUB_PROVIDER_ID,
      false,
    )
  }
  return known
}

/**
 * FFmpeg でプレースホルダ動画を生成するローカル Provider（ADR-0014）。
 * 一時的なモックではなく、CI と回帰テストのために恒久的に維持する実装。
 */
export const createStubVideoProvider = (options: StubProviderOptions): VideoProvider => {
  const { outputDir, simulatedLatencyMs } = StubProviderOptions.parse(options)
  const jobs = new Map<string, StubJob>()

  const update = (ref: string, patch: Partial<StubJob>): void => {
    const job = jobs.get(ref)
    if (job === undefined) return
    jobs.set(ref, { ...job, ...patch })
  }

  const render = async (ref: string, request: VideoGenerationRequest): Promise<void> => {
    const job = jobs.get(ref)
    if (job === undefined) return

    const model = resolveModel(request.model)
    const { spec } = request
    const generationDurationSec = quantizeDuration(spec.durationSec, model.capabilities.durations)
    const startedAt = Date.now()

    try {
      // ハッシュ計算も try の中で行う。render は await されないため、
      // ここで throw すると unhandled rejection になる。
      const specHash = await computeSpecHash(spec)
      if (simulatedLatencyMs > 0) await delay(simulatedLatencyMs, job.controller.signal)
      update(ref, { status: { state: 'running', progress: null } })

      const rendered = await renderPlaceholder(
        {
          outputPath: job.outputPath,
          durationSec: generationDurationSec,
          width: spec.resolution.width,
          height: spec.resolution.height,
          fps: spec.fps,
          backgroundColor: colorForShot(spec.shotId),
          lines: placeholderLines({ spec, model, generationDurationSec, specHash }),
          signature: specHash,
          seed: spec.seed,
        },
        { signal: job.controller.signal },
      )

      if (jobs.get(ref)?.cancelled === true) return

      update(ref, {
        status: {
          state: 'succeeded',
          outputUrl: pathToFileURL(job.outputPath).href,
          seedUsed: spec.seed,
          costUsd: model.economics.costPerSecondUsd * generationDurationSec,
          raw: {
            provider: 'stub',
            modelId: model.id,
            outputPath: job.outputPath,
            requestedDurationSec: spec.durationSec,
            generationDurationSec,
            width: spec.resolution.width,
            height: spec.resolution.height,
            fps: spec.fps,
            backgroundColor: colorForShot(spec.shotId),
            specHash,
            // drawtext を持たない ffmpeg ではテキストを焼けず、カラーバーへ縮退している。
            renderMode: rendered.mode,
            referenceCount: spec.references.length,
            renderMs: Date.now() - startedAt,
          },
        },
      })
    } catch (error) {
      if (jobs.get(ref)?.cancelled === true) return
      update(ref, {
        status: {
          state: 'failed',
          error: {
            code: 'stub_render_failed',
            message: errorMessage(error),
            retryable: true,
          },
        },
      })
    }
  }

  const submit = async (request: VideoGenerationRequest): Promise<ProviderJobHandle> => {
    const model = resolveModel(request.model)
    const violations = validateAgainstCapabilities(request.spec, model)
    if (violations.length > 0) throw new CapabilityViolationError(model.id, violations)

    await mkdir(outputDir, { recursive: true })

    const ref = randomUUID()
    const handle: ProviderJobHandle = {
      providerId: STUB_PROVIDER_ID,
      modelId: model.id,
      ref,
      submittedAt: new Date(),
    }

    jobs.set(ref, {
      handle,
      controller: new AbortController(),
      outputPath: join(outputDir, `${ref}.mp4`),
      status: { state: 'pending', progress: null },
      cancelled: false,
    })

    // 生成完了を待たずにハンドルを返す。実 Provider と同じくポーリングで結果を取る。
    void render(ref, request)

    return handle
  }

  // interface が Promise を返す以上、未知のハンドルも同期 throw ではなく reject で返す。
  const poll = (handle: ProviderJobHandle): Promise<ProviderJobStatus> => {
    const job = jobs.get(handle.ref)
    return job === undefined
      ? Promise.reject(unknownJobError(handle.ref))
      : Promise.resolve(job.status)
  }

  const cancel = (handle: ProviderJobHandle): Promise<void> => {
    const job = jobs.get(handle.ref)
    if (job === undefined) return Promise.reject(unknownJobError(handle.ref))
    if (job.status.state === 'succeeded' || job.status.state === 'failed') return Promise.resolve()

    job.controller.abort(new Error('ジョブがキャンセルされました'))
    update(handle.ref, { cancelled: true, status: CANCELLED })
    return Promise.resolve()
  }

  return {
    id: STUB_PROVIDER_ID,
    models: stubVideoModels,
    submit,
    poll,
    cancel,
  }
}
