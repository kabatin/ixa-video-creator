import { isSfxJobFinished, type SfxJob, type SfxJobError } from '@ixa/domain'
import { ProviderBusyError } from '@ixa/provider-core'
import { SFX_WORKFLOW_UNAVAILABLE_CODE } from '@ixa/provider-music'
import { LocalServerRequestError } from '@ixa/provider-video'
import { submitBusyDelayMs, submitBusyExpired } from '../generation/busy.js'
import {
  holdLocalGpuTurn,
  releaseLocalGpuTurn,
  requestLocalGpuTurn,
  type LocalGpuTurnJob,
} from '../generation/local-gpu-turn.js'
import { SfxJobCancelled, SfxJobFailure, type SfxAdapter, type SfxProcessorDeps } from './deps.js'
import { publishSfxJobStatus } from './events.js'
import { generateSfx } from './generate.js'
import { SfxJobData } from './job-data.js'

export type { SfxAdapter, SfxProcessorDeps } from './deps.js'

/**
 * 効果音を作るジョブ（ADR-0052）を 1 つ動かす。
 *
 * 手元の GPU を使う口（sfx-api）は、動画・高画質化・絵・曲と**同じ整理券**に並ぶ。
 * 順番が来ていなければ、待たずに積み直して手を離す（ジョブは queued のまま）。
 * 生成先が混んでいる（429）ときも失敗にせず、時間を置いて積み直す。
 */
export type SfxJobResult = { readonly state: 'missing' | 'skipped' | 'waiting' | 'busy' | 'succeeded' | 'failed' }

/** 積んでからこれを過ぎても GPU の順番が来なければやめる（絵と同じ）。 */
export const SFX_GPU_WAIT_DEADLINE_MS = 2 * 60 * 60 * 1000

export const SFX_GPU_TIMEOUT_MESSAGE =
  'この Mac の GPU の順番が 2 時間たっても回ってこなかったため、効果音を作るのをやめました。動画が空いてからもう一度作ってください。'
const GPU_UNAVAILABLE_MESSAGE = 'この Mac の GPU の順番を確かめられませんでした。少し待ってからもう一度作ってください。'
const BUSY_TIMEOUT_MESSAGE = '効果音を作る先が長く混んでいたため、作るのをやめました。少し待ってからもう一度作ってください。'

/**
 * 思わぬ失敗の画面の文。**例外の文は入れない**（手元のファイルの絶対パスや実装の言葉が混ざる）。
 * 理由はログ（`err`）にだけ残す。
 */
const UNEXPECTED: SfxJobError = {
  code: 'unexpected',
  message: '効果音を作れませんでした。少し待ってからもう一度作ってください。',
  retryable: true,
}

const turnJob = (job: SfxJob): LocalGpuTurnJob => ({ id: job.id, queuedAt: job.queuedAt, logContext: { sfxJobId: job.id } })

/** 順番を取って作る。取れなければ待つ長さ（積み直す）。 */
const runOnLocalGpu = async (
  deps: SfxProcessorDeps,
  adapter: SfxAdapter,
  job: SfxJob,
): Promise<{ readonly waitMs: number } | null> => {
  const outcome = await requestLocalGpuTurn(deps, {
    ...turnJob(job),
    waitDeadlineMs: SFX_GPU_WAIT_DEADLINE_MS,
    isCancelled: async () => (await deps.sfxJobs.findById(job.id))?.status === 'cancelled',
  })
  switch (outcome.state) {
    case 'wait':
      return { waitMs: outcome.delayMs }
    case 'cancelled':
      throw new SfxJobCancelled(job.id)
    case 'timeout':
      throw new SfxJobFailure({ code: 'local_gpu_timeout', message: SFX_GPU_TIMEOUT_MESSAGE, retryable: true })
    case 'unavailable':
      throw new SfxJobFailure({ code: 'local_gpu_unavailable', message: GPU_UNAVAILABLE_MESSAGE, retryable: true })
    case 'acquired':
      await holdLocalGpuTurn(deps, turnJob(job), () => generateSfx(deps, adapter, job))
      return null
  }
}

const findAdapter = (deps: SfxProcessorDeps, job: SfxJob): SfxAdapter => {
  const adapter = deps.adapters.find((candidate) => candidate.model.id === job.model)
  if (adapter === undefined) {
    throw new SfxJobFailure({
      code: 'provider_unavailable',
      message: 'この環境ではこの AI で効果音を作れません。「使う AI」で効果音の AI を選び直してください。',
      retryable: false,
    })
  }
  return adapter
}

export const processSfxJob = async (deps: SfxProcessorDeps, data: unknown): Promise<SfxJobResult> => {
  const parsed = SfxJobData.parse(data)
  const job = await deps.sfxJobs.findById(parsed.sfxJobId)
  if (job === null) {
    deps.logger.warn({ sfxJobId: parsed.sfxJobId }, '効果音のジョブが見つかりません')
    return { state: 'missing' }
  }
  // 終わったジョブと、人が止めたジョブは作らない。
  if (isSfxJobFinished(job.status)) {
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
      await generateSfx(deps, adapter, job)
    }
    return { state: 'succeeded' }
  } catch (error) {
    if (error instanceof SfxJobCancelled) {
      deps.logger.info({ sfxJobId: job.id }, '止められた効果音のジョブから手を引きました')
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
      error instanceof SfxJobFailure
        ? error.failure
        : error instanceof LocalServerRequestError && error.code === SFX_WORKFLOW_UNAVAILABLE_CODE
          ? // 使えない workflow。理由は provider が日本語で、置き場所を落として作っている。
            { code: error.code, message: error.message, retryable: false }
        : error instanceof ProviderBusyError
          ? { code: 'provider_busy_timeout', message: BUSY_TIMEOUT_MESSAGE, retryable: true }
          : UNEXPECTED
    deps.logger.error({ sfxJobId: job.id, code: failure.code, err: error }, '効果音を作れませんでした')
    const failed = await deps.sfxJobs.markFailed(job.id, failure, error instanceof SfxJobFailure ? error.record : null)
    await publishSfxJobStatus(deps, failed)
    return { state: 'failed' }
  }
}
