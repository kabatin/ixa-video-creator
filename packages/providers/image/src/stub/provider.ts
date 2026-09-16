import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CapabilityViolationError,
  ProviderError,
  validateImageRequest,
  type ImageGenerationRequest,
  type ImageJobStatus,
  type ImageModelDescriptor,
  type ImageProvider,
  type ProviderJobHandle,
  type ProviderOutput,
} from '@ixa/provider-core'
import { z } from 'zod'
import { colorForPrompt, figureColorForPrompt, fnv1a32, quadrantColorsForPrompt } from './color.js'
import { STUB_IMAGE_PROVIDER_ID, stubImageModels } from './descriptor.js'
import { placeholderModeFor } from './mode.js'
import { renderPlaceholderImage, type ImageRenderMode } from './render-image.js'

export const StubImageProviderOptions = z.object({
  /** 生成物の出力先。存在しなければ submit 時に作成する。 */
  outputDir: z.string().min(1),
  /** ポーリングの挙動を試すための擬似レイテンシ。既定 0。 */
  simulatedLatencyMs: z.number().int().nonnegative().default(0),
})
export type StubImageProviderOptions = {
  outputDir: string
  simulatedLatencyMs?: number
}

type StubImageJob = {
  readonly handle: ProviderJobHandle
  readonly controller: AbortController
  readonly outputPaths: readonly string[]
  readonly status: ImageJobStatus
  /** cancel 後に ffmpeg の失敗で状態を上書きしないためのフラグ。 */
  readonly cancelled: boolean
}

const CANCELLED: ImageJobStatus = {
  state: 'failed',
  error: { code: 'cancelled', message: 'ジョブはキャンセルされました', retryable: false },
}

const SEED_STRIDE = 7919
const INT32_MAX = 2147483647

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    // 既に中断済みなら abort イベントはもう飛ばない。ここで弾かないと待ち続けてしまう。
    if (signal.aborted) {
      reject(new Error('待機前に中断されました', { cause: signal.reason }))
      return
    }

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
  new ProviderError(`未知のジョブ ${ref} です`, STUB_IMAGE_PROVIDER_ID, false)

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** ジョブ参照（UUID）から決定的に seed を作る。同じジョブなら常に同じ値。 */
const hashToSeed = (ref: string): number => fnv1a32(ref) % INT32_MAX

/** 1 回の要求から複数枚出すとき、枚ごとに seed をずらして絵を変える。 */
export const imageSeedFor = (baseSeed: number, index: number): number =>
  (Math.abs(baseSeed) + index * SEED_STRIDE) % INT32_MAX

/** プロンプトの署名。画面に焼く 8 桁の 16 進で、どのプロンプト由来かを識別する。 */
export const signatureForPrompt = (prompt: string): string =>
  fnv1a32(prompt).toString(16).padStart(8, '0')

const resolveModel = (model: ImageModelDescriptor): ImageModelDescriptor => {
  const known = stubImageModels.find((candidate) => candidate.id === model.id)
  if (known === undefined) {
    throw new ProviderError(
      `スタブ画像 Provider は未知のモデル ${model.id} を扱えません`,
      STUB_IMAGE_PROVIDER_ID,
      false,
    )
  }
  return known
}

/**
 * FFmpeg でプレースホルダ画像を生成するローカル Provider（ADR-0014）。
 * 四面図（ARCHITECTURE.md §8）の構造が目で分かることを目的とし、
 * 絵が人物らしいことは目的にしない。CI と回帰テストのために恒久的に維持する。
 */
export const createStubImageProvider = (options: StubImageProviderOptions): ImageProvider => {
  const { outputDir, simulatedLatencyMs } = StubImageProviderOptions.parse(options)
  const jobs = new Map<string, StubImageJob>()

  const update = (ref: string, patch: Partial<StubImageJob>): void => {
    const job = jobs.get(ref)
    if (job === undefined) return
    jobs.set(ref, { ...job, ...patch })
  }

  const render = async (ref: string, request: ImageGenerationRequest): Promise<void> => {
    const job = jobs.get(ref)
    if (job === undefined) return

    const model = resolveModel(request.model)
    const startedAt = Date.now()

    try {
      const mode = placeholderModeFor(request.prompt)
      const signature = signatureForPrompt(request.prompt)
      const backgroundColor = colorForPrompt(request.prompt)
      const quadrantColors = quadrantColorsForPrompt(request.prompt)
      const figureColor = figureColorForPrompt(request.prompt)

      /**
       * seed が未指定なら、このジョブ固有の値をノイズの種にする。
       * 実 Provider は seed 無しのとき実行ごとに違う絵を返すため、
       * スタブが常に同じバイト列を返すと候補を選ぶ工程を試せない。
       * seedUsed には実際に使った値を返すので、再現もできる。
       */
      const baseSeed = request.seed ?? hashToSeed(ref)
      if (simulatedLatencyMs > 0) await delay(simulatedLatencyMs, job.controller.signal)
      // 待っている間に cancel されていたら running で上書きしない。
      if (jobs.get(ref)?.cancelled === true) return
      update(ref, { status: { state: 'running', progress: null } })

      const renderModes: ImageRenderMode[] = []
      for (const [index, outputPath] of job.outputPaths.entries()) {
        const rendered = await renderPlaceholderImage(
          {
            outputPath,
            width: request.resolution.width,
            height: request.resolution.height,
            mode,
            backgroundColor,
            quadrantColors,
            figureColor,
            signature,
            seed: imageSeedFor(baseSeed, index),
          },
          { signal: job.controller.signal },
        )
        renderModes.push(rendered.mode)
        if (jobs.get(ref)?.cancelled === true) return
      }

      const outputs: readonly ProviderOutput[] = job.outputPaths.map((path) => ({
        type: 'local',
        path,
      }))

      update(ref, {
        status: {
          state: 'succeeded',
          outputs,
          seedUsed: baseSeed,
          costUsd: model.economics.costPerImageUsd * job.outputPaths.length,
          raw: {
            provider: 'stub-image',
            modelId: model.id,
            mode,
            // drawtext を持たない ffmpeg ではラベルを焼けず、ティックマークへ縮退している。
            renderMode: renderModes[0] ?? null,
            outputPaths: [...job.outputPaths],
            count: job.outputPaths.length,
            width: request.resolution.width,
            height: request.resolution.height,
            aspectRatio: request.aspectRatio,
            backgroundColor,
            signature,
            referenceCount: request.references.length,
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
            code: 'stub_image_render_failed',
            message: errorMessage(error),
            retryable: true,
          },
        },
      })
    }
  }

  const submit = async (request: ImageGenerationRequest): Promise<ProviderJobHandle> => {
    const model = resolveModel(request.model)
    const violations = validateImageRequest(request, model)
    if (violations.length > 0) throw new CapabilityViolationError(model.id, violations)

    await mkdir(outputDir, { recursive: true })

    const ref = randomUUID()
    const handle: ProviderJobHandle = {
      providerId: STUB_IMAGE_PROVIDER_ID,
      modelId: model.id,
      ref,
      submittedAt: new Date(),
    }

    jobs.set(ref, {
      handle,
      controller: new AbortController(),
      outputPaths: Array.from({ length: request.count }, (_, index) =>
        join(outputDir, `${ref}-${index}.png`),
      ),
      status: { state: 'pending', progress: null },
      cancelled: false,
    })

    // 生成完了を待たずにハンドルを返す。実 Provider と同じくポーリングで結果を取る。
    void render(ref, request)

    return handle
  }

  // interface が Promise を返す以上、未知のハンドルも同期 throw ではなく reject で返す。
  const poll = (handle: ProviderJobHandle): Promise<ImageJobStatus> => {
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
    id: STUB_IMAGE_PROVIDER_ID,
    models: stubImageModels,
    submit,
    poll,
    cancel,
  }
}
