import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { quantizeDuration } from '@ixa/domain'
import { runFfmpeg } from '@ixa/media'
import {
  CapabilityViolationError,
  validateAgainstCapabilities,
  type ProviderJobHandle,
  type ProviderJobStatus,
  type VideoGenerationRequest,
  type VideoProvider,
} from '@ixa/provider-core'
import { z } from 'zod'
import {
  CANCELLED,
  errorMessage,
  failedStatus,
  hashToSeed,
  resolveModel,
  unknownJobError,
} from '../stub/job-helpers.js'
import { readStubJob, writeStubJob, type StoredStubJob } from '../stub/job-store.js'
import { LOCAL_PROVIDER_ID, localVideoModels } from './descriptor.js'
import { buildMotionFilter, planStillMotion } from './motion.js'

/**
 * ローカルの画像→動画 Provider（ADR-0025）。最初のフレームを ffmpeg の zoompan で動かす。
 *
 * ジョブの持ち方はスタブと同じ（`job-store`）。**投入した記録をディスクに残す**ので、
 * worker が再起動しても 2 つ動いていても、走っている生成を捨てない。
 */

export const LocalProviderOptions = z.object({
  /** 出来た動画とジョブの記録を置く場所。worker が取り込んだあとは消えてよい。 */
  outputDir: z.string().min(1),
})
export type LocalProviderOptions = z.input<typeof LocalProviderOptions>

type LocalJob = {
  readonly handle: ProviderJobHandle
  readonly controller: AbortController
  readonly outputPath: string
  readonly status: ProviderJobStatus
  readonly cancelled: boolean
}

/** 最初のフレームを読めない・動画にできないときの文。**画面に出るので内部の言葉を入れない。** */
const RENDER_FAILED_MESSAGE = '最初のフレームの画像から動画を作れませんでした'

export const createLocalImageToVideoProvider = (options: LocalProviderOptions): VideoProvider => {
  const { outputDir } = LocalProviderOptions.parse(options)
  const jobs = new Map<string, LocalJob>()

  const toStored = (job: LocalJob): StoredStubJob => ({
    ref: job.handle.ref,
    status: job.status,
    cancelled: job.cancelled,
  })

  const update = async (ref: string, patch: Partial<LocalJob>): Promise<void> => {
    const job = jobs.get(ref)
    if (job === undefined) return
    const next = { ...job, ...patch }
    // ディスクへ書き終えてからメモリへ反映する（スタブと同じ。別の instance が古い状態を読まないように）。
    await writeStubJob(outputDir, toStored(next))
    jobs.set(ref, next)
  }

  /** 失敗として決着させる。**ここから例外を出さない**（render は待たれない）。 */
  const settleFailed = async (ref: string, message: string): Promise<void> => {
    const status = failedStatus('local_render_failed', message, false)
    try {
      await update(ref, { status })
    } catch (error) {
      const job = jobs.get(ref)
      if (job !== undefined) {
        jobs.set(ref, { ...job, status: failedStatus('local_render_failed', `${message}（${errorMessage(error)}）`, false) })
      }
    }
  }

  const render = async (ref: string, request: VideoGenerationRequest): Promise<void> => {
    const job = jobs.get(ref)
    if (job === undefined) return
    const { spec } = request
    const model = resolveModel(LOCAL_PROVIDER_ID, localVideoModels, request.model)
    const durationSec = quantizeDuration(spec.durationSec, model.capabilities.durations)
    const seed = spec.seed ?? hashToSeed(ref)
    const startedAt = Date.now()

    try {
      const startFrame = spec.references.find((reference) => reference.role === 'start_frame')
      if (startFrame === undefined) throw new Error('最初のフレームがありません')
      const source = await request.resolveReference(startFrame.mediaAssetId)
      await update(ref, { status: { state: 'running', progress: null } })

      const motion = planStillMotion(spec.camera, seed)
      const frames = Math.max(1, Math.round(durationSec * spec.fps))
      const filter = buildMotionFilter(motion, {
        width: spec.resolution.width,
        height: spec.resolution.height,
        fps: spec.fps,
        frames,
      })
      await runFfmpeg(
        [
          '-y',
          '-i', source,
          '-filter_complex', filter,
          '-frames:v', String(frames),
          '-r', String(spec.fps),
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '18',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          // ジョブごとに必ず別のファイルにする。動きの組み合わせは有限で、別々のジョブが
          // 同じ動きを引くと同じバイト列になり、worker の checksum の重複判定で 1 本に
          // まとめられる（CI で 1 度そうなった）。同じジョブの取り込み直しは同じファイルのまま。
          '-metadata', `comment=ixa local/still-motion job ${ref}`,
          '-an',
          job.outputPath,
        ],
        { signal: job.controller.signal },
      )

      if (jobs.get(ref)?.cancelled === true) return
      await update(ref, {
        status: {
          state: 'succeeded',
          output: { type: 'local', path: job.outputPath },
          seedUsed: seed,
          costUsd: 0,
          raw: {
            provider: LOCAL_PROVIDER_ID,
            modelId: model.id,
            motion: motion.kind,
            amount: motion.amount,
            durationSec,
            width: spec.resolution.width,
            height: spec.resolution.height,
            fps: spec.fps,
            renderMs: Date.now() - startedAt,
          },
        },
      })
    } catch (error) {
      if (jobs.get(ref)?.cancelled === true) return
      // 理由（ffmpeg の出力や署名付き URL を含みうる）は画面に出さない。ログは worker が残す。
      await settleFailed(ref, `${RENDER_FAILED_MESSAGE}（${error instanceof Error ? error.name : 'Error'}）`)
    }
  }

  const submit = async (request: VideoGenerationRequest): Promise<ProviderJobHandle> => {
    const model = resolveModel(LOCAL_PROVIDER_ID, localVideoModels, request.model)
    const violations = validateAgainstCapabilities(request.spec, model)
    if (violations.length > 0) throw new CapabilityViolationError(model.id, violations)

    await mkdir(outputDir, { recursive: true })
    const ref = randomUUID()
    const handle: ProviderJobHandle = { providerId: LOCAL_PROVIDER_ID, modelId: model.id, ref, submittedAt: new Date() }
    const job: LocalJob = {
      handle,
      controller: new AbortController(),
      outputPath: join(outputDir, `${ref}.mp4`),
      status: { state: 'pending', progress: null },
      cancelled: false,
    }
    jobs.set(ref, job)
    // ハンドルを返す前にディスクへ残す（別のプロセスの問い合わせで捨てられないように）。
    await writeStubJob(outputDir, toStored(job))
    void render(ref, request)
    return handle
  }

  const poll = async (handle: ProviderJobHandle): Promise<ProviderJobStatus> => {
    const job = jobs.get(handle.ref)
    if (job !== undefined) return job.status
    const stored = await readStubJob(outputDir, handle.ref)
    if (stored.kind === 'found') return stored.job.status
    throw unknownJobError(LOCAL_PROVIDER_ID, handle.ref, stored.kind === 'unreadable' ? stored.cause : undefined)
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
      throw unknownJobError(LOCAL_PROVIDER_ID, handle.ref, stored.kind === 'unreadable' ? stored.cause : undefined)
    }
    if (stored.job.status.state === 'succeeded' || stored.job.status.state === 'failed') return
    await writeStubJob(outputDir, { ...stored.job, cancelled: true, status: CANCELLED })
  }

  return { id: LOCAL_PROVIDER_ID, models: localVideoModels, submit, poll, cancel }
}
