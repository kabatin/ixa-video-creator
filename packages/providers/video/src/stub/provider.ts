import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { computeSpecHash, quantizeDuration } from '@ixa/domain'
import {
  CapabilityViolationError,
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
import {
  CANCELLED,
  delay,
  errorMessage,
  failedStatus,
  hashToSeed,
  resolveModel,
  unknownJobError,
} from './job-helpers.js'
import { readStubJob, writeStubJob, type StoredStubJob } from './job-store.js'
import { placeholderLines } from './lines.js'
import { renderPlaceholder } from './render-placeholder.js'

export const StubProviderOptions = z.object({
  /** 生成物の出力先。存在しなければ submit 時に作成する。 */
  outputDir: z.string().min(1),
  /** ポーリングの挙動を試すための擬似レイテンシ。既定 0。 */
  simulatedLatencyMs: z.number().int().nonnegative().default(0),
  /**
   * 失敗させる割合（0〜1）。既定 0。**開発と検証のための口。**
   *
   * 失敗したときの経路（Shot を生成中から戻す・理由を画面まで運ぶ）は、
   * これが無いと**実 Provider を有料で回すまで一度も走らない**。
   * 初めて走るのが本番、という状態を作らないために置く。
   *
   * ジョブ参照から決定的に決めるので、同じジョブは何度試しても同じ結果になる。
   * 0.34 なら 3 本のうちおよそ 1 本が落ち、部分失敗も試せる。
   */
  failureRate: z.number().min(0).max(1).default(0),
  /**
   * 1 秒あたりの見かけの単価（USD）。既定 0。**開発と検証のための口。**
   *
   * スタブは本来ただなので `estimateCostUsd` が必ず 0 になり、
   * **予算ガード（`checkCostLimits`）は構造上ぜったいに発火しない。**
   * ドメインの単体テストは緑でも、API から画面までの経路は一度も走らない。
   * 失敗したときの経路と同じで、初回が本番＝有料になってしまう。
   *
   * 0 以外にすると見積にも実績にも乗るので、上限で止まることを無料で確かめられる。
   */
  costPerSecondUsd: z.number().min(0).default(0),
})
export type StubProviderOptions = {
  outputDir: string
  simulatedLatencyMs?: number
  failureRate?: number
  costPerSecondUsd?: number
}

/**
 * このジョブを失敗させるか。**乱数を使わない。**
 * 同じジョブが試すたびに違う結果になると、失敗の経路を追いかけられない。
 */
export const stubShouldFail = (ref: string, failureRate: number): boolean => {
  if (failureRate <= 0) return false
  if (failureRate >= 1) return true
  // ハッシュを 0..1 へ均す。seed 用の hashToSeed とは別の散らし方にして、
  // 「落ちるジョブだけ絵も同じ」のような偏りを作らない。
  let hash = 2_166_136_261
  for (let i = 0; i < ref.length; i += 1) {
    hash = Math.imul(hash ^ ref.charCodeAt(i), 16_777_619)
  }
  return ((hash >>> 8) % 1000) / 1000 < failureRate
}

type StubJob = {
  readonly handle: ProviderJobHandle
  readonly controller: AbortController
  readonly outputPath: string
  readonly status: ProviderJobStatus
  /** cancel 後に ffmpeg の失敗で状態を上書きしないためのフラグ。 */
  readonly cancelled: boolean
}

/**
 * FFmpeg でプレースホルダ動画を生成するローカル Provider（ADR-0014）。
 * 一時的なモックではなく、CI と回帰テストのために恒久的に維持する実装。
 */
export const createStubVideoProvider = (options: StubProviderOptions): VideoProvider => {
  const {
    outputDir,
    simulatedLatencyMs,
    failureRate,
    costPerSecondUsd,
  } = StubProviderOptions.parse(options)

  /**
   * 値段を差し替えたモデル一覧。**見積と実績の両方がこれを見る。**
   * 片方だけ差し替えると「見積は出るのに実績が 0」のような食い違いになる。
   */
  const models: readonly VideoModelDescriptor[] =
    costPerSecondUsd === 0
      ? stubVideoModels
      : stubVideoModels.map((model) => ({
          ...model,
          economics: { ...model.economics, costPerSecondUsd },
        }))
  const jobs = new Map<string, StubJob>()

  /** ディスクへ写す形。`AbortController` はプロセスを跨げないので持っていかない。 */
  const toStored = (job: StubJob): StoredStubJob => ({
    ref: job.handle.ref,
    status: job.status,
    cancelled: job.cancelled,
  })

  /** メモリだけを更新する。**ここは必ず成功する。** */
  const remember = (ref: string, patch: Partial<StubJob>): StubJob | null => {
    const job = jobs.get(ref)
    if (job === undefined) return null
    const next = { ...job, ...patch }
    jobs.set(ref, next)
    return next
  }

  /**
   * **ディスクへ書き終えてから**メモリへ反映する。書けなければ throw する（呼び出し側の try が拾う）。
   *
   * 逆順（メモリ → ディスク）だと、投入した instance が「完了」を返した瞬間に、別の instance が
   * ディスクを読むとまだ「実行中」になる（CI で `expected 'running' to be 'succeeded'` として落ちた）。
   * 書けなかったときは失敗の決着（`settleFailed`）がメモリにだけ残す。
   */
  const update = async (ref: string, patch: Partial<StubJob>): Promise<void> => {
    const job = jobs.get(ref)
    if (job === undefined) return
    const next = { ...job, ...patch }
    await writeStubJob(outputDir, toStored(next))
    jobs.set(ref, next)
  }

  /**
   * 失敗として決着させる。**ここから例外を出さない。**
   *
   * `render` は待たれないので、投げても unhandled rejection になるだけで理由が残らない。
   * ディスクへ書けなかったときは、その理由も同じ文へ畳んでメモリには必ず残す。
   */
  const settleFailed = async (ref: string, code: string, message: string): Promise<void> => {
    try {
      await update(ref, { status: failedStatus(code, message, true) })
    } catch (error) {
      remember(ref, { status: failedStatus(code, `${message}（${errorMessage(error)}）`, true) })
    }
  }

  const render = async (ref: string, request: VideoGenerationRequest): Promise<void> => {
    const job = jobs.get(ref)
    if (job === undefined) return

    const model = resolveModel(STUB_PROVIDER_ID, models, request.model)
    const { spec } = request
    const generationDurationSec = quantizeDuration(spec.durationSec, model.capabilities.durations)
    const startedAt = Date.now()

    try {
      // ハッシュ計算も try の中で行う。render は await されないため、
      // ここで throw すると unhandled rejection になる。
      const specHash = await computeSpecHash(spec)

      /**
       * seed が未指定なら、このジョブ固有の値をノイズの種にする。
       *
       * 実 Provider は seed 無しのとき実行ごとに違う絵を返す。
       * スタブが毎回まったく同じバイト列を返すと、
       * 1 Shot に複数 Take を作っても内容が同一になり、
       * **Take を比較して選ぶ工程を試せない**（ストレージ側の重複排除にも当たる）。
       * seedUsed には実際に使った値を返すので、再現もできる。
       */
      const effectiveSeed = spec.seed ?? hashToSeed(ref)
      if (simulatedLatencyMs > 0) await delay(simulatedLatencyMs, job.controller.signal)

      // **わざと落とす口**（`failureRate`）。実 Provider が落ちたときと同じ形で返す。
      // retryable にするのは、実際の失敗の大半が一時的なものだから。
      if (stubShouldFail(ref, failureRate)) {
        if (jobs.get(ref)?.cancelled === true) return
        await settleFailed(
          ref,
          'stub_injected_failure',
          'スタブの設定により失敗させました（STUB_VIDEO_FAILURE_RATE）',
        )
        return
      }
      // 待っている間に cancel されていたら running で上書きしない。
      if (jobs.get(ref)?.cancelled === true) return
      await update(ref, { status: { state: 'running', progress: null } })

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
          seed: effectiveSeed,
        },
        { signal: job.controller.signal },
      )

      if (jobs.get(ref)?.cancelled === true) return

      await update(ref, {
        status: {
          state: 'succeeded',
          output: { type: 'local', path: job.outputPath },
          seedUsed: effectiveSeed,
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
      await settleFailed(ref, 'stub_render_failed', errorMessage(error))
    }
  }

  const submit = async (request: VideoGenerationRequest): Promise<ProviderJobHandle> => {
    const model = resolveModel(STUB_PROVIDER_ID, models, request.model)
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

    const job: StubJob = {
      handle,
      controller: new AbortController(),
      outputPath: join(outputDir, `${ref}.mp4`),
      status: { state: 'pending', progress: null },
      cancelled: false,
    }
    jobs.set(ref, job)

    // **ハンドルを返す前にディスクへ残す。** ここを後回しにすると、投入した直後に
    // 別のプロセスが問い合わせたとき記録が無く、走っている生成が捨てられる。
    await writeStubJob(outputDir, toStored(job))

    // 生成完了を待たずにハンドルを返す。実 Provider と同じくポーリングで結果を取る。
    void render(ref, request)

    return handle
  }

  /**
   * 状態を返す。メモリに無ければディスクを見る。
   *
   * **別のプロセスが投入したジョブもここで拾える。** これがこの Provider の肝で、
   * worker が再起動しても 2 つ動いていても、投入済みの生成を捨てずに済む。
   */
  const poll = async (handle: ProviderJobHandle): Promise<ProviderJobStatus> => {
    const job = jobs.get(handle.ref)
    if (job !== undefined) return job.status

    const stored = await readStubJob(outputDir, handle.ref)
    if (stored.kind === 'found') return stored.job.status
    // 壊れた JSON は「無い」と同じ扱い。中身を推測して状態を作らない。
    throw unknownJobError(STUB_PROVIDER_ID, handle.ref, stored.kind === 'unreadable' ? stored.cause : undefined)
  }

  const cancel = async (handle: ProviderJobHandle): Promise<void> => {
    const job = jobs.get(handle.ref)
    if (job !== undefined) {
      if (job.status.state === 'succeeded' || job.status.state === 'failed') return
      job.controller.abort(new Error('ジョブがキャンセルされました'))
      await update(handle.ref, { cancelled: true, status: CANCELLED })
      return
    }

    const stored = await readStubJob(outputDir, handle.ref)
    if (stored.kind !== 'found') {
      throw unknownJobError(STUB_PROVIDER_ID, handle.ref, stored.kind === 'unreadable' ? stored.cause : undefined)
    }
    if (stored.job.status.state === 'succeeded' || stored.job.status.state === 'failed') return

    /**
     * 別のプロセスが走らせているジョブ。**既に動いている ffmpeg は落とせない。**
     * `AbortController` はプロセスを跨げないので、ここでできるのは記録を
     * cancelled にすることだけ。描画はそのまま最後まで走り、終わった時点で
     * 走らせている側が結果を書き戻す（向こうのメモリではキャンセルされていないため）。
     * 本当に止めるには、実 Provider と同じく走らせている側に取り消しの口が要る。
     */
    await writeStubJob(outputDir, { ...stored.job, cancelled: true, status: CANCELLED })
  }

  return {
    id: STUB_PROVIDER_ID,
    models,
    submit,
    poll,
    cancel,
  }
}
