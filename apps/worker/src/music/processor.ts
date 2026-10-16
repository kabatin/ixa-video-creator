import { isMusicJobFinished, type MusicJob, type MusicJobError } from '@ixa/domain'
import { ProviderBusyError } from '@ixa/provider-core'
import { submitBusyDelayMs, submitBusyExpired } from '../generation/busy.js'
import {
  holdLocalGpuTurn,
  releaseLocalGpuTurn,
  requestLocalGpuTurn,
  type LocalGpuTurnJob,
} from '../generation/local-gpu-turn.js'
import { MusicJobCancelled, MusicJobFailure, type MusicAdapter, type MusicProcessorDeps } from './deps.js'
import { publishMusicJobStatus } from './events.js'
import { generateMusic } from './generate.js'
import { MusicJobData } from './job-data.js'

export type { MusicAdapter, MusicProcessorDeps } from './deps.js'

/**
 * 曲を作るジョブ（ADR-0048）を 1 つ動かす。
 *
 * 手元の GPU を使う口（ace-step）は、動画・高画質化・絵と**同じ整理券**に並ぶ。
 * 順番が来ていなければ、待たずに積み直して手を離す（ジョブは queued のまま）。
 * 生成先が混んでいる（429）ときも失敗にせず、時間を置いて積み直す。
 */
export type MusicJobResult = { readonly state: 'missing' | 'skipped' | 'waiting' | 'busy' | 'succeeded' | 'failed' }

/** 積んでからこれを過ぎても GPU の順番が来なければやめる（絵と同じ）。 */
export const MUSIC_GPU_WAIT_DEADLINE_MS = 2 * 60 * 60 * 1000

export const MUSIC_GPU_TIMEOUT_MESSAGE =
  'この Mac の GPU の順番が 2 時間たっても回ってこなかったため、曲を作るのをやめました。動画が空いてからもう一度作ってください。'
const GPU_UNAVAILABLE_MESSAGE = 'この Mac の GPU の順番を確かめられませんでした。少し待ってからもう一度作ってください。'
const BUSY_TIMEOUT_MESSAGE = '曲を作る先が長く混んでいたため、作るのをやめました。少し待ってからもう一度作ってください。'

const describeUnexpected = (error: unknown): MusicJobError => ({
  code: 'unexpected',
  message: `曲を作れませんでした: ${error instanceof Error ? error.message : String(error)}`,
  retryable: true,
})

const turnJob = (job: MusicJob): LocalGpuTurnJob => ({ id: job.id, queuedAt: job.queuedAt, logContext: { musicJobId: job.id } })

/** 順番を取って作る。取れなければ待つ長さ（積み直す）。 */
const runOnLocalGpu = async (
  deps: MusicProcessorDeps,
  adapter: MusicAdapter,
  job: MusicJob,
): Promise<{ readonly waitMs: number } | null> => {
  const outcome = await requestLocalGpuTurn(deps, {
    ...turnJob(job),
    waitDeadlineMs: MUSIC_GPU_WAIT_DEADLINE_MS,
    isCancelled: async () => (await deps.musicJobs.findById(job.id))?.status === 'cancelled',
  })
  switch (outcome.state) {
    case 'wait':
      return { waitMs: outcome.delayMs }
    case 'cancelled':
      throw new MusicJobCancelled(job.id)
    case 'timeout':
      throw new MusicJobFailure({ code: 'local_gpu_timeout', message: MUSIC_GPU_TIMEOUT_MESSAGE, retryable: true })
    case 'unavailable':
      throw new MusicJobFailure({ code: 'local_gpu_unavailable', message: GPU_UNAVAILABLE_MESSAGE, retryable: true })
    case 'acquired':
      await holdLocalGpuTurn(deps, turnJob(job), () => generateMusic(deps, adapter, job))
      return null
  }
}

const findAdapter = (deps: MusicProcessorDeps, job: MusicJob): MusicAdapter => {
  const adapter = deps.adapters.find((candidate) => candidate.model.id === job.model)
  if (adapter === undefined) {
    throw new MusicJobFailure({
      code: 'provider_unavailable',
      message: 'この環境ではこの AI で曲を作れません。「使う AI」で曲の AI を選び直してください。',
      retryable: false,
    })
  }
  return adapter
}

export const processMusicJob = async (deps: MusicProcessorDeps, data: unknown): Promise<MusicJobResult> => {
  const parsed = MusicJobData.parse(data)
  const job = await deps.musicJobs.findById(parsed.musicJobId)
  if (job === null) {
    deps.logger.warn({ musicJobId: parsed.musicJobId }, '曲のジョブが見つかりません')
    return { state: 'missing' }
  }
  // 終わったジョブと、人が止めたジョブは作らない。
  if (isMusicJobFinished(job.status)) {
    // 順番待ちの間に止められたジョブは、券を列に残したまま手を引かない（後ろの GPU の仕事が 15 分待たされる）。
    const exclusive = deps.adapters.find((candidate) => candidate.model.id === job.model)?.provider.exclusiveResource
    if (job.status === 'cancelled' && exclusive === 'local-gpu') await releaseLocalGpuTurn(deps, turnJob(job))
    return { state: 'skipped' }
  }

  try {
    const adapter = findAdapter(deps, job)
    if (adapter.provider.exclusiveResource === 'local-gpu') {
      const wait = await runOnLocalGpu(deps, adapter, job)
      if (wait !== null) {
        await deps.scheduler.reschedule(parsed, wait.waitMs)
        return { state: 'waiting' }
      }
    } else {
      await generateMusic(deps, adapter, job)
    }
    return { state: 'succeeded' }
  } catch (error) {
    if (error instanceof MusicJobCancelled) {
      deps.logger.info({ musicJobId: job.id }, '止められた曲のジョブから手を引きました')
      return { state: 'skipped' }
    }
    // 生成先が混んでいる。何も積まれていないので（冪等キーで投げ直しても同じジョブになる）時間を置く。
    const now = deps.now?.() ?? new Date()
    if (error instanceof ProviderBusyError && !submitBusyExpired(job.queuedAt, now)) {
      await deps.scheduler.reschedule(parsed, submitBusyDelayMs(error.retryAfterMs))
      return { state: 'busy' }
    }
    // **握り潰さない。** 理由をジョブに残して画面へ出し、ログにも残す。
    const failure =
      error instanceof MusicJobFailure
        ? error.failure
        : error instanceof ProviderBusyError
          ? { code: 'provider_busy_timeout', message: BUSY_TIMEOUT_MESSAGE, retryable: true }
          : describeUnexpected(error)
    deps.logger.error({ musicJobId: job.id, code: failure.code, err: error }, '曲を作れませんでした')
    const failed = await deps.musicJobs.markFailed(job.id, failure, error instanceof MusicJobFailure ? error.record : null)
    await publishMusicJobStatus(deps, failed)
    return { state: 'failed' }
  }
}
