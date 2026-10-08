import {
  UPSCALE_REASON,
  type MediaAsset,
  type Project,
  type Shot,
  type Take,
  type UpscaleJob,
} from '@ixa/domain'
import type { MediaAssetRepository, ProjectRepository, ShotRepository, TakeRepository, UpscaleJobRepository } from '@ixa/db'
import { ProviderBusyError, type ProviderJobHandle, type VideoUpscaler } from '@ixa/provider-core'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { recordTake, type RecordTakeDeps } from '../generation/complete.js'
import { submitBusyDelayMs, submitBusyExpired, SUBMIT_BUSY_TIMEOUT_MESSAGE } from '../generation/busy.js'
import {
  LOCAL_GPU_HEAD_RETRY_AFTER_MS,
  LOCAL_GPU_RETRY_AFTER_MS,
  type LocalGpuLease,
} from '../generation/local-gpu-lease.js'
import { parseUpscaleJobData, type UpscaleJobData } from './job-data.js'

/**
 * 出来上がった Take の解像度を上げる（ADR-0044 / FlashVSR）。
 *
 * **生成（`generation/processor.ts`）とは別の仕事。** あちらは仕様から作り、行から仕様を
 * 組み直して `specHash` を突き合わせる。こちらは**出来上がった動画そのもの**を渡すだけで、
 * 組み直す仕様が無い。
 *
 * 流れは生成と同じ 2 段構え（投入 → 問い合わせ）。
 * **手元の GPU の順番（整理券）は生成と共有する。** 同じ `localGpuLease` を同じ作法で取るので、
 * H3 の生成と同時には走らない。
 */

export const UPSCALE_POLL_DELAY_MS = 30_000
/**
 * 送ってからこれを過ぎても終わらなければ諦める。
 * サーバ側の打ち切り（見込み × 3 ＋ 5 分）のほうが先に来るので、ここは最後の網。
 */
export const UPSCALE_DEADLINE_MS = 3 * 60 * 60 * 1000

export type UpscaleOutcome =
  | { readonly state: 'submitted' }
  | { readonly state: 'polling' }
  | { readonly state: 'busy'; readonly delayMs: number }
  | { readonly state: 'succeeded'; readonly takeId: string }
  | { readonly state: 'failed'; readonly code: string }
  | { readonly state: 'skipped'; readonly reason: string }

export type UpscaleScheduler = {
  reschedule(data: UpscaleJobData, delayMs: number): Promise<void>
}

export type UpscaleProcessorDeps = RecordTakeDeps & {
  readonly upscaleJobs: UpscaleJobRepository
  readonly takes: TakeRepository
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly mediaAssets: MediaAssetRepository
  readonly storage: ObjectStorage
  readonly upscaler: VideoUpscaler
  readonly localGpuLease: LocalGpuLease
  readonly scheduler: UpscaleScheduler
  readonly logger: Logger
  readonly now?: () => Date
}

/** 終端の失敗。利用者に見せる文を持つ（実装の言葉を入れない）。 */
class UpscaleFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'UpscaleFailure'
  }
}

const TERMINAL: readonly UpscaleJob['status'][] = ['succeeded', 'failed', 'cancelled']

/** 借りを返す。**ここで投げない**（返せなくても期限で空く。生成と同じ扱い）。 */
const releaseGpu = async (deps: UpscaleProcessorDeps, jobId: string): Promise<void> => {
  try {
    await deps.localGpuLease.release(jobId)
  } catch (error) {
    deps.logger.warn({ jobId, err: error }, 'この機械の GPU の順番を返せませんでした')
  }
}

/** 元の Take の動画を、そのまま base64 で読む。 */
const readSourceVideo = async (
  deps: UpscaleProcessorDeps,
  asset: MediaAsset,
): Promise<string> => {
  const body = await deps.storage.get(asset.storageKey)
  return Buffer.from(body).toString('base64')
}

/**
 * 出す大きさは**元の Take と同じ**。
 * **推測で埋めない。** 測れていない素材は、大きさを決めようがないので止める。
 */
const outputSizeOf = (asset: MediaAsset): { readonly width: number; readonly height: number } => {
  const width = asset.probe?.width ?? null
  const height = asset.probe?.height ?? null
  if (width === null || height === null) {
    throw new UpscaleFailure('source_size_unknown', '元の映像の大きさが分かりませんでした。', false)
  }
  return { width, height }
}

type Loaded = {
  readonly job: UpscaleJob
  readonly shot: Shot
  readonly project: Project
  readonly source: Take
  readonly sourceAsset: MediaAsset
}

const load = async (deps: UpscaleProcessorDeps, job: UpscaleJob): Promise<Loaded> => {
  const shot = await deps.shots.findById(job.shotId)
  if (shot === null) throw new UpscaleFailure('shot_missing', 'この Shot は消されました。', false)
  const project = await deps.projects.findById(shot.projectId)
  if (project === null) throw new UpscaleFailure('project_missing', 'この作品は消されました。', false)
  // 見えなくした Take も元にできる（記録としては正しい）。
  const source = await deps.takes.findById(job.sourceTakeId, { includeHidden: true })
  if (source === null) throw new UpscaleFailure('source_missing', '元の Take が見つかりませんでした。', false)
  const sourceAsset = await deps.mediaAssets.findById(source.mediaAssetId)
  if (sourceAsset === null) {
    throw new UpscaleFailure('source_media_missing', '元の映像が見つかりませんでした。', false)
  }
  return { job, shot, project, source, sourceAsset }
}

/** 生成先へ送る。順番が取れなければ何も送らず、時間を置いて予約し直す。 */
const submit = async (
  deps: UpscaleProcessorDeps,
  data: UpscaleJobData,
  loaded: Loaded,
  now: Date,
): Promise<UpscaleOutcome> => {
  const { job } = loaded

  // 券の番号は積んだ時刻。空いていても自分の番でなければ取らない（整理券。ADR-0044）。
  const lease = await deps.localGpuLease.acquire(job.id, job.queuedAt.getTime())
  if (lease.state !== 'acquired') {
    if (submitBusyExpired(job.queuedAt, now)) {
      throw new UpscaleFailure('provider_busy_timeout', SUBMIT_BUSY_TIMEOUT_MESSAGE, true)
    }
    const atHead = lease.ahead === 0
    const delayMs = submitBusyDelayMs(
      atHead ? LOCAL_GPU_HEAD_RETRY_AFTER_MS : LOCAL_GPU_RETRY_AFTER_MS,
      { atHead },
    )
    await deps.scheduler.reschedule(data, delayMs)
    return { state: 'busy', delayMs }
  }

  try {
    const submission = await deps.upscaler.submit({
      video: { data: await readSourceVideo(deps, loaded.sourceAsset), mediaType: 'video/mp4' },
      output: outputSizeOf(loaded.sourceAsset),
      // 投げ直しても二重に作らせない。
      idempotencyKey: job.id,
    })
    await deps.upscaleJobs.markRunning(job.id, {
      providerJobRef: submission.handle.ref,
      estimateSeconds: submission.estimateSeconds,
      providerRecord: { workflow: deps.upscaler.modelId },
    })
    await deps.scheduler.reschedule(data, UPSCALE_POLL_DELAY_MS)
    deps.logger.info(
      { jobId: job.id, ref: submission.handle.ref, estimateSeconds: submission.estimateSeconds },
      '解像度を上げる仕事を生成先へ投入しました',
    )
    return { state: 'submitted' }
  } catch (error) {
    // 満杯は失敗にしない。何も送れていないので順番を返して待つ。
    if (error instanceof ProviderBusyError) {
      await releaseGpu(deps, job.id)
      if (submitBusyExpired(job.queuedAt, now)) {
        throw new UpscaleFailure('provider_busy_timeout', SUBMIT_BUSY_TIMEOUT_MESSAGE, true)
      }
      const delayMs = submitBusyDelayMs(error.retryAfterMs)
      await deps.scheduler.reschedule(data, delayMs)
      return { state: 'busy', delayMs }
    }
    throw error
  }
}

/** 送った仕事の様子を見る。 */
const poll = async (
  deps: UpscaleProcessorDeps,
  data: UpscaleJobData,
  loaded: Loaded,
  providerJobRef: string,
  now: Date,
): Promise<UpscaleOutcome> => {
  const { job, shot, project, source } = loaded
  await deps.localGpuLease.renew(job.id)

  const handle: ProviderJobHandle = {
    providerId: deps.upscaler.providerId,
    modelId: deps.upscaler.modelId,
    ref: providerJobRef,
    submittedAt: job.startedAt ?? job.queuedAt,
  }
  const status = await deps.upscaler.poll(handle)

  if (status.state === 'failed') {
    throw new UpscaleFailure(status.error.code, status.error.message, status.error.retryable)
  }

  // **まだ終わっていない。** `succeeded` 以外をまとめて受けるので、状態が増えても取りこぼさない
  if (status.state !== 'succeeded') {
    const startedAt = job.startedAt ?? job.queuedAt
    if (now.getTime() - startedAt.getTime() > UPSCALE_DEADLINE_MS) {
      throw new UpscaleFailure('upscale_timeout', '解像度を上げるのに時間が掛かりすぎました。', true)
    }
    await deps.scheduler.reschedule(data, UPSCALE_POLL_DELAY_MS)
    return { state: 'polling' }
  }

  /**
   * **出来たものは元の Take の隣に積む（追記のみ）。**
   * `spec` と `specHash` は元から写す。**同じ仕様**であり、違うのは後処理だから。
   * 系譜（親と理由）は**作る瞬間にしか入らない**ので、ここで必ず入れる。
   */
  const take = await recordTake(deps, {
    shot,
    project,
    spec: source.spec,
    specHash: source.specHash,
    providerId: deps.upscaler.providerId,
    modelId: deps.upscaler.modelId,
    output: status.output,
    seedUsed: null,
    costUsd: 0,
    raw: { ...status.raw, sourceTakeId: source.id },
    generationTimeSec: Math.max(0, (now.getTime() - (job.startedAt ?? job.queuedAt).getTime()) / 1000),
    lineage: { parentTakeId: source.id, regenerationReason: UPSCALE_REASON },
  })

  await deps.upscaleJobs.markSucceeded(job.id, take.id, { sourceTakeId: source.id })
  await releaseGpu(deps, job.id)
  deps.logger.info({ jobId: job.id, takeId: take.id }, '解像度を上げた Take を作りました')
  return { state: 'succeeded', takeId: take.id }
}

export const processUpscaleJob = async (
  deps: UpscaleProcessorDeps,
  data: unknown,
): Promise<UpscaleOutcome> => {
  const parsed = parseUpscaleJobData(data)
  const now = (deps.now ?? (() => new Date()))()

  const job = await deps.upscaleJobs.findById(parsed.upscaleJobId)
  if (job === null) throw new Error(`UpscaleJob が見つかりません: ${parsed.upscaleJobId}`)

  // 冪等性の要。同じジョブが 2 回走っても Take を二重に作らない。
  if (TERMINAL.includes(job.status)) {
    // 取り消しは API が行だけを変える。worker はここで気付くので、順番はここで返す。
    await releaseGpu(deps, job.id)
    return { state: 'skipped', reason: `status=${job.status}` }
  }

  try {
    const loaded = await load(deps, job)
    return job.providerJobRef === null
      ? await submit(deps, parsed, loaded, now)
      : await poll(deps, parsed, loaded, job.providerJobRef, now)
  } catch (error) {
    if (error instanceof UpscaleFailure) {
      await deps.upscaleJobs.markFailed(
        job.id,
        { code: error.code, message: error.message, retryable: error.retryable },
        null,
      )
      await releaseGpu(deps, job.id)
      deps.logger.warn({ jobId: job.id, code: error.code }, '解像度を上げる仕事が失敗しました')
      return { state: 'failed', code: error.code }
    }
    // 知らない失敗は握り潰さない。順番だけ返して投げ直す（キューが数え、再試行する）。
    await releaseGpu(deps, job.id)
    throw error
  }
}
