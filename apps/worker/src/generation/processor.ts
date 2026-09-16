import type {
  GenerationJobRepository, MediaAssetRepository, ProjectRepository, ShotRepository, TakeRepository,
} from '@ixa/db'
import {
  GenerationJobId as GenerationJobIdSchema,
  type GenerationContextSource,
  type GenerationJob,
  type MediaAssetId,
  type Project,
  type Shot,
  type TakeId,
} from '@ixa/domain'
import type {
  ProviderJobHandle, ProviderJobStatus, ProviderRegistry, VideoModelDescriptor,
} from '@ixa/provider-core'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { z } from 'zod'
import { recordTake, type RecordTakeDeps } from './complete.js'
import { rebuildSpec } from './spec.js'

/**
 * generation キューのジョブ処理（docs/ARCHITECTURE.md §11 / §20）。
 *
 * - ジョブデータは ID のみ。実データは DB から読む（DB が真実。ADR-0008）
 * - 外部ジョブのポーリングは repeatable job ではなく指数バックオフの再スケジュール
 * - 冪等。終了済みのジョブを再実行しても Take を二重に作らない
 */

export const GenerationJobData = z.object({ generationJobId: GenerationJobIdSchema })
export type GenerationJobData = z.infer<typeof GenerationJobData>

/** ポーリング間隔の初期値と上限。 */
export const POLL_BACKOFF_BASE_MS = 5_000
export const POLL_BACKOFF_MAX_MS = 120_000
/** これを超えたら諦めて failed にする。既定で約 2 時間分。 */
export const MAX_POLL_ATTEMPTS = 60

/** 参照画像を Provider に見せるための署名付き URL の有効期限（秒）。 */
export const REFERENCE_URL_EXPIRES_SEC = 900

/** 指数バックオフ。attempt は 1 始まり。 */
export const pollDelayMs = (attempt: number): number =>
  Math.min(POLL_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), POLL_BACKOFF_MAX_MS)

/** ポーリングの再スケジュール口。BullMQ への依存を配線側に閉じ込める。 */
export type PollScheduler = {
  reschedule(data: GenerationJobData, delayMs: number): Promise<void>
}

/**
 * 生成した MediaAsset を media キューへ回す口。
 *
 * **生成物にも probe と最終フレームが要る。** 最終フレームは次の Shot の
 * 連続性参照（`previousShotLastFrame`）そのものなので、ここを通さないと
 * 参照解決が黙って 1 つ欠けたまま動き続ける。
 */
export type MediaJobQueue = {
  enqueue(mediaAssetId: MediaAssetId): Promise<void>
}

export type GenerationProcessorDeps = RecordTakeDeps & {
  readonly generationJobs: GenerationJobRepository
  readonly shots: ShotRepository
  readonly projects: ProjectRepository
  readonly mediaAssets: MediaAssetRepository
  readonly storage: ObjectStorage
  readonly takes: TakeRepository
  readonly registry: ProviderRegistry
  readonly context: GenerationContextSource
  readonly scheduler: PollScheduler
  readonly mediaQueue: MediaJobQueue
  readonly logger: Logger
  readonly now?: () => Date
}

export type GenerationOutcome =
  | { readonly state: 'skipped'; readonly reason: string }
  | { readonly state: 'submitted'; readonly providerJobRef: string }
  | { readonly state: 'polling'; readonly delayMs: number }
  | { readonly state: 'succeeded'; readonly takeId: TakeId }
  | { readonly state: 'failed'; readonly code: string }

/** 作業を続けられない状態。GenerationJob.error に落として failed にする。 */
class JobFailure extends Error {
  override readonly name = 'JobFailure'
  constructor(readonly code: string, message: string, readonly retryable: boolean) {
    super(message)
  }
}

const TERMINAL_STATUSES: readonly GenerationJob['status'][] = ['succeeded', 'failed', 'cancelled']

/** Provider に参照画像を見せるための署名付き URL。DB には保存しない（規約 7）。 */
const referenceResolver =
  (mediaAssets: MediaAssetRepository, storage: ObjectStorage) => async (id: MediaAssetId) => {
    const asset = await mediaAssets.findById(id)
    if (asset === null) throw new JobFailure('reference_missing', `参照アセットがありません: ${id}`, false)
    return storage.signedGetUrl(asset.storageKey, REFERENCE_URL_EXPIRES_SEC)
  }

const loadModel = (registry: ProviderRegistry, job: GenerationJob): VideoModelDescriptor => {
  if (job.resolvedModel === null) {
    throw new JobFailure('model_unresolved', 'resolvedModel が未設定のジョブです', false)
  }
  try {
    return registry.findModel(job.resolvedModel)
  } catch {
    throw new JobFailure('unknown_model', `未登録のモデルです: ${job.resolvedModel}`, false)
  }
}

/** Provider へ投入し、最初のポーリングを予約する。 */
const submit = async (
  deps: GenerationProcessorDeps,
  job: GenerationJob,
  shot: Shot,
  project: Project,
  model: VideoModelDescriptor,
  now: Date,
): Promise<GenerationOutcome> => {
  const { spec, specHash } = await rebuildSpec(deps.context, shot, project, model)
  if (specHash !== job.specHash) {
    // Shot が編集されて仕様が変わっている。古い仕様で課金しないよう止める。
    throw new JobFailure(
      'spec_drift',
      `Shot が変更されたため仕様が一致しません（job=${job.specHash} / now=${specHash}）`,
      false,
    )
  }

  const provider = deps.registry.providerFor(model.id)
  const handle = await provider.submit({
    model,
    spec,
    resolveReference: referenceResolver(deps.mediaAssets, deps.storage),
  })

  await deps.generationJobs.update(job.id, {
    status: 'running',
    providerJobRef: handle.ref,
    startedAt: job.startedAt ?? now,
  })
  await deps.scheduler.reschedule({ generationJobId: job.id }, pollDelayMs(1))

  deps.logger.info({ jobId: job.id, ref: handle.ref }, 'Provider へ生成ジョブを投入しました')
  return { state: 'submitted', providerJobRef: handle.ref }
}

/** 完了応答から MediaAsset と Take を作り、ジョブを succeeded にする。 */
const complete = async (
  deps: GenerationProcessorDeps,
  job: GenerationJob,
  shot: Shot,
  project: Project,
  model: VideoModelDescriptor,
  status: Extract<ProviderJobStatus, { state: 'succeeded' }>,
  now: Date,
): Promise<GenerationOutcome> => {
  const { spec, specHash } = await rebuildSpec(deps.context, shot, project, model)
  const startedAt = job.startedAt ?? job.queuedAt

  const take = await recordTake(deps, {
    shot,
    project,
    spec,
    // 生成に使ったのはジョブが記録している仕様。再組み立てとずれても履歴は job を正とする。
    specHash: job.specHash === specHash ? specHash : job.specHash,
    providerId: model.providerId,
    modelId: model.id,
    output: status.output,
    seedUsed: status.seedUsed,
    costUsd: status.costUsd,
    raw: status.raw,
    generationTimeSec: Math.max(0, (now.getTime() - startedAt.getTime()) / 1000),
  })

  /**
   * **投入の失敗でジョブを落とさない。**
   * ここに来た時点で生成は成功し、課金も済み、Take も確定している。
   * Redis の一時的な不調でそれを failed にすると、払った金額を捨てたうえ
   * Shot が generating のまま取り残される。失われるのは probe・サムネイル・
   * 最終フレームだけで、media ジョブは冪等なので後から流し直せる。
   *
   * ただし黙って落とさない。最終フレームが無いと次の Shot の連続性参照が
   * 欠けるため、流し直す対象が分かるよう mediaAssetId ごと error で残す。
   */
  try {
    await deps.mediaQueue.enqueue(take.mediaAssetId)
  } catch (error) {
    deps.logger.error(
      { jobId: job.id, takeId: take.id, mediaAssetId: take.mediaAssetId, err: error },
      'media キューへ投入できませんでした。probe と最終フレームが作られていません',
    )
  }

  await deps.shots.updateStatus(shot.id, 'review')
  await deps.generationJobs.update(job.id, { status: 'succeeded', finishedAt: now })

  deps.logger.info({ jobId: job.id, takeId: take.id }, 'Take を確定しました')
  return { state: 'succeeded', takeId: take.id }
}

/** 進行中の外部ジョブを 1 回だけ問い合わせる。 */
const poll = async (
  deps: GenerationProcessorDeps,
  job: GenerationJob,
  shot: Shot,
  project: Project,
  model: VideoModelDescriptor,
  providerJobRef: string,
  now: Date,
): Promise<GenerationOutcome> => {
  const provider = deps.registry.providerFor(model.id)
  const handle: ProviderJobHandle = {
    providerId: model.providerId,
    modelId: model.id,
    ref: providerJobRef,
    submittedAt: job.startedAt ?? job.queuedAt,
  }

  const status = await provider.poll(handle)

  if (status.state === 'succeeded') return complete(deps, job, shot, project, model, status, now)

  if (status.state === 'failed') {
    throw new JobFailure(status.error.code, status.error.message, status.error.retryable)
  }

  const attempt = job.attempt + 1
  if (attempt > MAX_POLL_ATTEMPTS) {
    throw new JobFailure('poll_timeout', `ポーリングが ${String(MAX_POLL_ATTEMPTS)} 回を超えました`, false)
  }

  await deps.generationJobs.update(job.id, { attempt })
  const delayMs = pollDelayMs(attempt)
  // repeatable job は使わない。都度、指数バックオフで入れ直す（ARCHITECTURE.md §20）。
  await deps.scheduler.reschedule({ generationJobId: job.id }, delayMs)
  return { state: 'polling', delayMs }
}

/**
 * generation ジョブを 1 回分進める。
 * 未投入なら submit、投入済みなら poll。終了済みなら何もしない。
 */
export const processGenerationJob = async (
  deps: GenerationProcessorDeps,
  data: unknown,
): Promise<GenerationOutcome> => {
  const { generationJobId } = GenerationJobData.parse(data)
  const now = (deps.now ?? (() => new Date()))()

  const job = await deps.generationJobs.findById(generationJobId)
  if (job === null) {
    throw new Error(`GenerationJob が見つかりません: ${generationJobId}`)
  }

  // 冪等性の要。同じジョブが 2 回走っても Take を二重に作らない。
  if (TERMINAL_STATUSES.includes(job.status)) {
    deps.logger.debug({ jobId: job.id, status: job.status }, '終了済みのジョブなので何もしません')
    return { state: 'skipped', reason: `status=${job.status}` }
  }

  try {
    const shot = await deps.shots.findById(job.shotId)
    if (shot === null) throw new JobFailure('shot_missing', `Shot がありません: ${job.shotId}`, false)

    const project = await deps.projects.findById(shot.projectId)
    if (project === null) {
      throw new JobFailure('project_missing', `Project がありません: ${shot.projectId}`, false)
    }

    const model = loadModel(deps.registry, job)

    return job.providerJobRef === null
      ? await submit(deps, job, shot, project, model, now)
      : await poll(deps, job, shot, project, model, job.providerJobRef, now)
  } catch (error) {
    const failure =
      error instanceof JobFailure
        ? error
        : new JobFailure(
            errorCodeOf(error),
            error instanceof Error ? error.message : String(error),
            false,
          )

    await deps.generationJobs.update(job.id, {
      status: 'failed',
      finishedAt: now,
      error: { code: failure.code, message: failure.message, retryable: failure.retryable },
    })
    deps.logger.error({ jobId: job.id, code: failure.code, err: error }, '生成ジョブが失敗しました')
    return { state: 'failed', code: failure.code }
  }
}

/** DownloadError など、code を持つエラーからコードを取り出す。 */
const errorCodeOf = (error: unknown): string => {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  return error instanceof Error ? error.name : 'unknown_error'
}
