import type {
  GenerationJobRepository,
  MediaAssetRepository,
  ProjectRepository,
  ShotRepository,
  TakeRepository,
} from '@ixa/db'
import {
  type GenerationContextSource,
  type GenerationJob,
  type GenerationJobId,
  type MediaAssetId,
  type Project,
  type ProjectEventPublisher,
  type Shot,
  type TakeId,
  quantizeDuration,
  settledShotStatus,
} from '@ixa/domain'
import { ProviderBusyError, ProviderError } from '@ixa/provider-core'
import type {
  ProviderJobHandle,
  ProviderJobStatus,
  ProviderRegistry,
  VideoModelDescriptor,
} from '@ixa/provider-core'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import {
  SUBMIT_BUSY_TIMEOUT_MESSAGE,
  submitBusyDelayMs,
  submitBusyExpired,
} from './busy.js'
import { generationBenchmarkOf, logGenerationBenchmark } from './benchmark.js'
import {
  LOCAL_GPU_RETRY_AFTER_MS,
  type LocalGpuLease,
} from './local-gpu-lease.js'
import { recordTake, type RecordTakeDeps } from './complete.js'
import { failureMessageOf, publishJobStatus, publishShotStatus } from './events.js'
import { parseGenerationJobData, type GenerationJobData } from './job-data.js'
import { pollDelayMs, pollPolicyForJob, pollPolicyOf } from './poll-policy.js'
import { checkLineage, lineageFailureOf, lineageFieldsOf, type LineageCheck } from './lineage.js'
import { shotStatusAfterFailure } from './shot-status-after-failure.js'
import { rebuildSpec } from './spec.js'
import { cancelledSince, stopAbandonedJob, stopAtProvider } from './stop.js'

/**
 * generation キューのジョブ処理（docs/ARCHITECTURE.md §11 / §20）。
 *
 * - ジョブデータは ID のみ。実データは DB から読む（DB が真実。ADR-0008）
 * - 外部ジョブのポーリングは repeatable job ではなく指数バックオフの再スケジュール
 * - 冪等。終了済みのジョブを再実行しても Take を二重に作らない
 */

/** 問い合わせの間隔と回数は `poll-policy.ts`（Provider ごとに変えられる。ADR-0031）。 */
export {
  MAX_POLL_ATTEMPTS,
  POLL_BACKOFF_BASE_MS,
  POLL_BACKOFF_MAX_MS,
  pollDelayMs,
} from './poll-policy.js'

/** 参照画像を Provider に見せるための署名付き URL の有効期限（秒）。 */
export const REFERENCE_URL_EXPIRES_SEC = 900

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
  /**
   * この機械の GPU を 1 本ずつに揃える口（ADR-0040）。
   * **`exclusiveResource: 'local-gpu'` を名乗る Provider のジョブだけ**がこれを借りる。
   * 配線されていなければ順番を作らず、作らなかったことをログに残す（`createUnprotectedLocalGpuLease`）。
   */
  readonly localGpuLease: LocalGpuLease
  /**
   * 状態が変わった瞬間に出来事を流す口（Phase 5.8b）。
   * **publish の失敗で本処理を止めない。** 詳細は `events.ts`。
   */
  readonly events: ProjectEventPublisher
  readonly logger: Logger
  readonly now?: () => Date
}

export type GenerationOutcome =
  | { readonly state: 'skipped'; readonly reason: string }
  | { readonly state: 'submitted'; readonly providerJobRef: string }
  | { readonly state: 'polling'; readonly delayMs: number }
  /** Provider が満杯で投入を断った。queued のまま投入し直しを予約した（ADR-0031）。 */
  | { readonly state: 'busy'; readonly delayMs: number }
  | { readonly state: 'succeeded'; readonly takeId: TakeId }
  | { readonly state: 'failed'; readonly code: string }

/**
 * 頼んだあとで仕様が変わったときの文（画面に出る）。
 *
 * Shot 自身の編集だけでなく、**前の Shot の採用 Take が変わっても**仕様は変わる
 * （連続性の参照＝前の Shot の最後のコマが、採用 Take から決まるため）。
 * 順番待ちが長い Provider（ADR-0031）では、待っている間に前の Shot で採用し直すと起きる。
 */
export const SPEC_DRIFT_MESSAGE =
  '頼んだあとで、この Shot の内容か、前の Shot の採用 Take（続きの最初のフレームに使う最後のコマ）が変わりました。' +
  '古い内容のまま作らないよう取りやめたので、もう一度生成してください。'

/**
 * この機械の GPU が空くのを待っているときの理由（ADR-0040）。**ログに残る文**で、
 * 画面には「順番待ち」として出る（`generation-progress.ts` が時間から文を作る）。
 */
export const LOCAL_GPU_BUSY_MESSAGE =
  'この Mac で別の動画を作っている最中です（ローカルの動画生成は 1 本ずつ）'

/**
 * GPU の順番を返す。**ここで投げない。** 返せなかったことで生成の結果を変えない
 * （期限（`LOCAL_GPU_LEASE_TTL_MS`）が来れば勝手に空く）。黙って捨てずログに残す。
 */
const releaseLocalGpu = async (
  deps: Pick<GenerationProcessorDeps, 'localGpuLease' | 'logger'>,
  jobId: GenerationJobId,
): Promise<void> => {
  try {
    await deps.localGpuLease.release(jobId)
  } catch (error) {
    deps.logger.warn(
      { jobId, err: error },
      'この機械の GPU の順番を返せませんでした。期限が切れるまで次の生成が待たされます',
    )
  }
}

/**
 * 借りている間、期限を延ばす。**ほかのジョブに取られていたら残す。**
 * それは借りが切れている間に別の生成が始まったということで、2 本が同時に GPU を使っている。
 * 黙って進むと「1 本ずつにしたつもりが同時に走っていた」に気付けない。
 */
const renewLocalGpu = async (
  deps: Pick<GenerationProcessorDeps, 'localGpuLease' | 'logger'>,
  jobId: GenerationJobId,
): Promise<void> => {
  try {
    const lease = await deps.localGpuLease.renew(jobId)
    if (lease.state === 'held') {
      deps.logger.warn(
        { jobId, heldBy: lease.by },
        'この機械の GPU の順番が別の生成に移っていました。ローカルの生成が同時に走っている可能性があります',
      )
    }
  } catch (error) {
    deps.logger.warn({ jobId, err: error }, 'この機械の GPU の順番を延ばせませんでした')
  }
}

/**
 * ジョブの行から Provider を引いて、GPU を使う Provider なら順番を返す。
 * **Provider を手元に持っていない場面**（終端の失敗・終了済みのジョブ）のための口。
 * モデルが未登録・未解決なら何もしない（その理由は別の検査が言う）。
 */
const releaseLocalGpuForJob = async (
  deps: GenerationProcessorDeps,
  job: GenerationJob,
): Promise<void> => {
  if (job.resolvedModel === null) return
  const usesLocalGpu = ((): boolean => {
    try {
      return deps.registry.providerFor(job.resolvedModel).exclusiveResource === 'local-gpu'
    } catch {
      return false
    }
  })()
  if (usesLocalGpu) await releaseLocalGpu(deps, job.id)
}

/**
 * 頼んだ生成尺（秒）。**Shot の編集尺ではなくモデルが作る尺**（ADR-0011 の切り上げ後）。
 * 読めなければ null（出せない数字を推測で埋めない）。
 */
const requestedDurationSecOf = (
  shot: Shot | null,
  model: VideoModelDescriptor | null,
): number | null => {
  if (shot === null || model === null) return null
  try {
    return quantizeDuration(shot.durationSec, model.capabilities.durations)
  } catch {
    // 作れない尺（最長の 1.5 倍超）。そのジョブは別の検査で止まる。
    return null
  }
}

/** 作業を続けられない状態。GenerationJob.error に落として failed にする。 */
class JobFailure extends Error {
  override readonly name = 'JobFailure'
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

const TERMINAL_STATUSES: readonly GenerationJob['status'][] = ['succeeded', 'failed', 'cancelled']

/**
 * 1 回分の処理に必要な、DB から読み直した実体一式。
 * `data` も持ち回るが、運んでいるのは ID だけ。系譜は `job` の行から読む。
 */
type JobContext = {
  readonly job: GenerationJob
  readonly shot: Shot
  readonly project: Project
  readonly model: VideoModelDescriptor
  readonly data: GenerationJobData
  readonly now: Date
}

/**
 * ジョブの行に載っている系譜を検査する。親を辿れなければ理由付きで返る。
 * 投入前に呼べば、壊れた系譜のまま課金することがない。
 */
const inspectLineage = (deps: GenerationProcessorDeps, ctx: JobContext): Promise<LineageCheck> =>
  checkLineage(deps.takes, ctx.shot.id, ctx.job)

/** Provider に参照画像を見せるための署名付き URL。DB には保存しない（規約 7）。 */
const referenceResolver =
  (mediaAssets: MediaAssetRepository, storage: ObjectStorage) => async (id: MediaAssetId) => {
    const asset = await mediaAssets.findById(id)
    if (asset === null)
      throw new JobFailure('reference_missing', `参照アセットがありません: ${id}`, false)
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
  ctx: JobContext,
): Promise<GenerationOutcome> => {
  const { job, shot, project, model, now } = ctx

  /**
   * **系譜の検査は投入の前に置く。**
   * ここで落ちるのは 1 回も課金していない状態なので安い。
   * 完了後に気付いても、生成済みの Take を捨てるか系譜を諦めるかしか選べなくなる。
   */
  const lineageFailure = lineageFailureOf(await inspectLineage(deps, ctx))
  if (lineageFailure !== null) {
    throw new JobFailure(lineageFailure.code, lineageFailure.message, false)
  }

  const { spec, specHash } = await rebuildSpec(deps.context, shot, project, model, job.corrections, job.seed)
  if (specHash !== job.specHash) {
    // Shot が編集されて仕様が変わっている。古い仕様で課金しないよう止める。
    // ハッシュは内部の値なので画面の文には入れず、ログにだけ残す。
    deps.logger.warn(
      { jobId: job.id, jobSpecHash: job.specHash, currentSpecHash: specHash },
      '頼んだときと仕様が変わったため投入しません',
    )
    throw new JobFailure('spec_drift', SPEC_DRIFT_MESSAGE, false)
  }

  const provider = deps.registry.providerFor(model.id)

  /**
   * この機械の GPU を使う Provider なら、**投入の前に順番を取る**（ADR-0040）。
   * 取れなければ何も送らずに queued のまま待つ（`waitForProviderSlot` と同じ経路）。
   * 画像を取り寄せる前に止まるので、順番待ちが署名付き URL と 20MB の読み込みを繰り返さない。
   */
  const holdsLocalGpu = provider.exclusiveResource === 'local-gpu'
  if (holdsLocalGpu) {
    const lease = await deps.localGpuLease.acquire(job.id)
    if (lease.state === 'held') {
      return waitForProviderSlot(
        deps,
        ctx,
        new ProviderBusyError(
          LOCAL_GPU_BUSY_MESSAGE,
          model.providerId,
          LOCAL_GPU_RETRY_AFTER_MS,
        ),
      )
    }
  }

  const handle = await provider
    .submit({
      model,
      spec,
      resolveReference: referenceResolver(deps.mediaAssets, deps.storage),
      // 投げ直しても同じ生成だと Provider が分かるように（応答が失われた投入の二重生成を防ぐ。ADR-0031）。
      idempotencyKey: job.id,
    })
    // 満杯の断りだけは失敗にしない。ほかの例外はそのまま投げる（下の catch が終端にする）。
    .catch((error: unknown) => {
      if (error instanceof ProviderBusyError) return error
      throw error
    })
  if (handle instanceof ProviderBusyError) {
    // 何も投入できていないので GPU の順番は離す（押さえたまま待つと、ほかの生成も止まる）。
    if (holdsLocalGpu) await releaseLocalGpu(deps, job.id)
    return waitForProviderSlot(deps, ctx, handle)
  }

  // 送っている間に制作者がやめた。生成先にも止めてと頼み、作成中にしない（送った先は記録に残す）。
  if (await cancelledSince(deps.generationJobs, job.id)) {
    await deps.generationJobs.update(job.id, { providerJobRef: handle.ref })
    await stopAtProvider(deps, handle, job.id)
    if (holdsLocalGpu) await releaseLocalGpu(deps, job.id)
    deps.logger.info({ jobId: job.id, ref: handle.ref }, '送っている間に生成をやめたので、生成先にも止めてと頼みました')
    return { state: 'skipped', reason: 'cancelled' }
  }

  await deps.generationJobs.update(job.id, {
    status: 'running',
    providerJobRef: handle.ref,
    startedAt: job.startedAt ?? now,
  })
  await publishJobStatus(deps, {
    shot,
    jobId: job.id,
    status: 'running',
    takeId: null,
    error: null,
    at: now,
  })
  // 運ぶのは ID だけ。系譜は行に載っているので、入れ直しで失われることがない。
  await deps.scheduler.reschedule(ctx.data, pollDelayMs(1, pollPolicyOf(provider)))

  deps.logger.info({ jobId: job.id, ref: handle.ref }, 'Provider へ生成ジョブを投入しました')
  return { state: 'submitted', providerJobRef: handle.ref }
}

/**
 * Provider が満杯で断った投入を、**queued のまま**時間を置いて予約し直す（ADR-0031）。
 *
 * 何も投入されていないので `running` にもしないし `attempt` も増やさない（`busy.ts`）。
 * 次の回も系譜と仕様の検査から通るので、待っている間に Shot が編集されれば spec_drift で止まる。
 * 積んでから `SUBMIT_BUSY_DEADLINE_MS` を過ぎたら終端の失敗にする（やり直せる失敗として記録する）。
 * 予約し直しに失敗したら（キューに入れられない）、ここから投げて終端の失敗にする。
 * 何も投入していないので捨てても払ったものは無く、queued のまま取り残すよりよい。
 */
const waitForProviderSlot = async (
  deps: GenerationProcessorDeps,
  ctx: JobContext,
  busy: ProviderBusyError,
): Promise<GenerationOutcome> => {
  const { job, now } = ctx
  if (submitBusyExpired(job.queuedAt, now)) {
    throw new JobFailure('provider_busy_timeout', SUBMIT_BUSY_TIMEOUT_MESSAGE, true)
  }

  const delayMs = submitBusyDelayMs(busy.retryAfterMs)
  await deps.scheduler.reschedule(ctx.data, delayMs)
  // 断った理由（満杯・応答なし・同じ投入が処理中）を残す。捨てると、諦めたときに何が起きていたか分からない。
  deps.logger.warn(
    {
      jobId: job.id,
      providerId: busy.providerId,
      delayMs,
      queuedAt: job.queuedAt.toISOString(),
      err: busy,
    },
    `生成先が投入を断ったため、待って予約し直しました: ${busy.message}`,
  )
  return { state: 'busy', delayMs }
}

/** 完了応答から MediaAsset と Take を作り、ジョブを succeeded にする。 */
const complete = async (
  deps: GenerationProcessorDeps,
  ctx: JobContext,
  status: Extract<ProviderJobStatus, { state: 'succeeded' }>,
): Promise<GenerationOutcome> => {
  const { job, shot, project, model, now } = ctx

  // 作っている間に制作者がやめた。届いた結果は Take にしない（ジョブの行は取り消しのまま残る）。
  if (await cancelledSince(deps.generationJobs, job.id)) {
    deps.logger.info({ jobId: job.id }, '生成をやめた後に結果が届いたので、Take にしません')
    return { state: 'skipped', reason: 'cancelled' }
  }

  const { spec, specHash } = await rebuildSpec(deps.context, shot, project, model)
  // 生成時間は生成先が作り始めてから（送った後の順番待ちを含めない。制作者 2026-10-04）。
  const startedAt = job.providerStartedAt ?? job.startedAt ?? job.queuedAt

  /**
   * 投入時に通った系譜でも、完了までの間に親が消えていることはある。
   * **その場合でも Take は確定させる。** ここに来た時点で生成は成功し課金も済んでいて、
   * 系譜が辿れないことは作り直しても直らない。
   * 代わりに理由だけを残し（`lineageFieldsOf`）、何が欠けたかを error で出す。
   */
  const lineage = await inspectLineage(deps, ctx)
  const lineageFailure = lineageFailureOf(lineage)
  if (lineageFailure !== null) {
    deps.logger.error(
      { jobId: job.id, shotId: shot.id, code: lineageFailure.code },
      `${lineageFailure.message}。理由だけを残して Take を確定します`,
    )
  }

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
    lineage: lineageFieldsOf(lineage),
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

  /**
   * 状態は `settledShotStatus`（domain）で決める。**採用が決定**（ADR-0023）なので、
   * 採用済みの Shot で作り直しに成功しても採用済みのまま。以前は一律 `review` に戻し、
   * 作り直しを 1 本試すだけで「採用待ち」に落ちていた。
   * 採用は生成の最中にも変わりうるので、ジョブの頭で読んだ値ではなく読み直した値を使う。
   */
  const latest = (await deps.shots.findById(shot.id)) ?? shot
  const settled = settledShotStatus({ hasSelectedTake: latest.selectedTakeId !== null, hasTakes: true })
  await deps.shots.updateStatus(shot.id, settled)
  await deps.generationJobs.update(job.id, { status: 'succeeded', finishedAt: now })

  /**
   * **Take の確定は publish の結果に関わらず成立する。**
   * ここより上で Take もジョブの行も確定済みで、通知はその上乗せでしかない。
   * 落ちたら warn に残すだけにする（`ProjectEventPublisher` の契約）。
   */
  await publishShotStatus(deps, { shot, jobId: job.id, status: settled, at: now })
  await publishJobStatus(deps, {
    shot,
    jobId: job.id,
    status: 'succeeded',
    takeId: take.id,
    error: null,
    at: now,
  })

  // H3 と Wan を後から数字で比べるための 1 行（ADR-0040）。
  logGenerationBenchmark(
    deps.logger,
    job.id,
    generationBenchmarkOf({ job, model, requestedDurationSec: spec.durationSec, now, status }),
  )

  deps.logger.info({ jobId: job.id, takeId: take.id }, 'Take を確定しました')
  return { state: 'succeeded', takeId: take.id }
}

/** 進行中の外部ジョブを 1 回だけ問い合わせる。 */
const poll = async (
  deps: GenerationProcessorDeps,
  ctx: JobContext,
  providerJobRef: string,
): Promise<GenerationOutcome> => {
  const { job, model } = ctx
  const provider = deps.registry.providerFor(model.id)
  const handle: ProviderJobHandle = {
    providerId: model.providerId,
    modelId: model.id,
    ref: providerJobRef,
    submittedAt: job.startedAt ?? job.queuedAt,
  }

  const status = await provider.poll(handle)

  /**
   * この機械の GPU を使う Provider なら、**終わった時点で順番を返し、作っている間は期限を延ばす**
   * （ADR-0040）。返すのは出力を取り寄せる前でよい（生成はもう終わっていて GPU は空いている）。
   * 問い合わせが投げたときは下の catch が返す。
   */
  if (provider.exclusiveResource === 'local-gpu') {
    if (status.state === 'succeeded' || status.state === 'failed') {
      await releaseLocalGpu(deps, job.id)
    } else {
      await renewLocalGpu(deps, job.id)
    }
  }

  /**
   * 生成先が作り始めた時刻を 1 度だけ残す（制作者 2026-10-04「カット２，３が作成中になってる」）。
   * 送った後も生成先の中で順番を待つことがある（vpipe は 1 本ずつ）。待っている間（pending）は残さない。
   * 「作成中」を見ないまま終わった生成には付けない（いま作り始めたことにすると、生成時間が 0 になる）。
   */
  const started = job.providerStartedAt === null && status.state === 'running' ? ctx.now : job.providerStartedAt
  if (started !== job.providerStartedAt) await deps.generationJobs.update(job.id, { providerStartedAt: started })

  if (status.state === 'succeeded') return complete(deps, ctx, status)

  if (status.state === 'failed') {
    throw new JobFailure(status.error.code, status.error.message, status.error.retryable)
  }

  // 間隔の上限と諦める回数は Provider の方針に従う（無ければ既定。ADR-0031）。
  const policy = pollPolicyOf(provider)
  const attempt = job.attempt + 1
  if (attempt > policy.maxAttempts) {
    throw new JobFailure(
      'poll_timeout',
      `ポーリングが ${String(policy.maxAttempts)} 回を超えました`,
      false,
    )
  }

  await deps.generationJobs.update(job.id, { attempt })
  const delayMs = pollDelayMs(attempt, policy)
  // repeatable job は使わない。都度、指数バックオフで入れ直す（ARCHITECTURE.md §20）。
  await deps.scheduler.reschedule(ctx.data, delayMs)
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
  const parsed = parseGenerationJobData(data)
  const now = (deps.now ?? (() => new Date()))()

  const job = await deps.generationJobs.findById(parsed.generationJobId)
  if (job === null) {
    throw new Error(`GenerationJob が見つかりません: ${parsed.generationJobId}`)
  }

  // 冪等性の要。同じジョブが 2 回走っても Take を二重に作らない。
  if (TERMINAL_STATUSES.includes(job.status)) {
    /**
     * 取り消しは API がジョブの行だけを変える（生成先には API が止めてと頼む）。
     * worker はここで初めて気付くので、**押さえていた GPU の順番はここで返す**（ADR-0040）。
     * 期限（`LOCAL_GPU_LEASE_TTL_MS`）を待つと、次の生成が数分黙って止まる。
     */
    await releaseLocalGpuForJob(deps, job)
    deps.logger.debug({ jobId: job.id, status: job.status }, '終了済みのジョブなので何もしません')
    return { state: 'skipped', reason: `status=${job.status}` }
  }

  /**
   * 失敗したときも出来事を流したいが、出来事には projectId が要る。
   * projectId は Shot にしか無く、Shot を読む前に落ちることもあるため、
   * 読めたところで控えておく。読めていなければ流さず、流せなかったことを残す。
   */
  let loadedShot: Shot | null = null
  /**
   * 失敗したときも実測を 1 行残すために控える（ADR-0040）。失敗だけ記録に残らないと、
   * 失敗の多いモデルが速く見える。モデルを引く前に落ちたら null のまま（推測で埋めない）。
   */
  let loadedModel: VideoModelDescriptor | null = null

  try {
    const shot = await deps.shots.findById(job.shotId)
    if (shot === null)
      throw new JobFailure('shot_missing', `Shot がありません: ${job.shotId}`, false)
    loadedShot = shot

    const project = await deps.projects.findById(shot.projectId)
    if (project === null) {
      throw new JobFailure('project_missing', `Project がありません: ${shot.projectId}`, false)
    }

    const model = loadModel(deps.registry, job)
    loadedModel = model

    const ctx: JobContext = {
      job,
      shot,
      project,
      model,
      data: parsed,
      now,
    }

    return job.providerJobRef === null
      ? await submit(deps, ctx)
      : await poll(deps, ctx, job.providerJobRef)
  } catch (error) {
    /**
     * **投入済みのジョブは、問い合わせが一度こけただけで捨てない。**
     *
     * `providerJobRef` があるということは Provider 側で生成が走っており、
     * 実 Provider ではその時点で課金が確定している。ここで終端の `failed` にすると、
     * 払った生成をこちらの都合（一時的な 5xx・429・接続断）で捨てることになる。
     * 以前は `ProviderError.retryable` を見ずに `false` へ潰していたため、
     * 通信が 1 回揺れただけで Take が消えていた。
     *
     * 実 Provider をつなぐまでは無料なので誰も気づけない。つなぐ前にここを直す。
     */
    // 問い合わせの間に制作者がやめた。取り消しを失敗で上書きしない（Shot は API が決め直している）。
    if (await cancelledDuringFailure(deps, job.id)) {
      await releaseLocalGpuForJob(deps, job)
      return { state: 'skipped', reason: 'cancelled' }
    }

    /**
     * **予約し直すなら GPU の順番は離さない。** 投入済みのジョブは生成先で走り続けているので、
     * ここで離すと別のローカル生成が始まり、2 本が同時に GPU を使う。
     */
    const retried = await reschedulePollAfterTransient(deps, job, error, now)
    if (retried !== null) return retried

    // ここから先は終端。生成はもう続かないので順番を返す。
    await releaseLocalGpuForJob(deps, job)

    const failure =
      error instanceof JobFailure
        ? error
        : new JobFailure(
            errorCodeOf(error),
            error instanceof Error ? error.message : String(error),
            // **Provider が「やり直せる」と言っているなら、そのまま記録する。**
            // ここで false に潰すと、行を見ても再試行の余地があったか分からない。
            isRetryableProviderError(error),
          )

    const message = failureMessageOf(failure)
    await deps.generationJobs.update(job.id, {
      status: 'failed',
      finishedAt: now,
      error: { code: failure.code, message, retryable: failure.retryable },
    })
    deps.logger.error({ jobId: job.id, code: failure.code, err: error }, '生成ジョブが失敗しました')
    // 失敗も同じ形で残す（ADR-0040）。モデルを引く前に落ちていれば残さない。
    if (loadedModel !== null) {
      logGenerationBenchmark(
        deps.logger,
        job.id,
        generationBenchmarkOf({
          job,
          model: loadedModel,
          requestedDurationSec: requestedDurationSecOf(loadedShot, loadedModel),
          now,
          failureType: failure.code,
        }),
      )
    }
    // 生成先で作り続けて GPU を占めないよう、止めてと頼む（届かなくても失敗の記録は変えない）。
    await stopAbandonedJob(deps, job)

    if (loadedShot === null) {
      // 流さなかったことを残す。黙って省くと、届かない理由がどこにも無くなる（lessons L-015）。
      deps.logger.warn(
        { jobId: job.id, shotId: job.shotId },
        'Shot を読めなかったため、失敗の出来事を流せませんでした',
      )
    } else {
      // **Shot を `generating` のままにしない。** 戻す経路が無いと、失敗した Shot は
      // DB ごと生成中で固まり、画面の生成ボタンが二度と押せなくなる。
      await releaseShotAfterFailure(deps, loadedShot, job.id, now)

      // **黙って失敗にしない。** 行に残したのと同じ理由を画面まで運ぶ。
      await publishJobStatus(deps, {
        shot: loadedShot,
        jobId: job.id,
        status: 'failed',
        takeId: null,
        error: message,
        at: now,
      })
    }

    return { state: 'failed', code: failure.code }
  }
}

/**
 * 失敗したジョブの分だけ Shot を生成中から解放する。
 *
 * **ここで投げない。** 呼ぶのは失敗処理の途中で、ジョブの行と出来事はもう確定している。
 * 解放に失敗したことで失敗処理そのものを壊すと、理由が誰にも届かなくなる。
 * 落ちたら warn に残して先へ進む（`ProjectEventPublisher` と同じ約束）。
 */
const releaseShotAfterFailure = async (
  deps: GenerationProcessorDeps,
  shot: Shot,
  failedJobId: GenerationJobId,
  now: Date,
): Promise<void> => {
  try {
    const [jobs, takes, latest] = await Promise.all([
      deps.generationJobs.findByShot(shot.id),
      deps.takes.findByShot(shot.id),
      deps.shots.findById(shot.id),
    ])
    const next = shotStatusAfterFailure({
      jobs,
      failedJobId,
      hasTakes: takes.length > 0,
      // 採用は生成の最中にも変わりうる。頭で読んだ値ではなく読み直した値を使う。
      hasSelectedTake: (latest ?? shot).selectedTakeId !== null,
    })
    // null は「ほかのジョブがまだ走っている」。状態はそちらの決着に任せる。
    if (next === null) return

    const moved = await deps.shots.updateStatus(shot.id, next)
    await publishShotStatus(deps, { shot: moved, jobId: failedJobId, status: next, at: now })
  } catch (error) {
    deps.logger.warn(
      { jobId: failedJobId, shotId: shot.id, err: error },
      'Shot を生成中から戻せませんでした。生成中のまま残っている可能性がある',
    )
  }
}

/**
 * 失敗を書く前に、制作者がやめていないか読み直す。**読めなければ false**（失敗を書く）。
 * ここで投げると失敗の理由が誰にも届かなくなるので、読めなかったことを残して進む。
 */
const cancelledDuringFailure = async (
  deps: GenerationProcessorDeps,
  jobId: GenerationJobId,
): Promise<boolean> => {
  try {
    return await cancelledSince(deps.generationJobs, jobId)
  } catch (error) {
    deps.logger.warn({ jobId, err: error }, '取り消されたかを読み直せませんでした。失敗として記録します')
    return false
  }
}

/** Provider が「やり直せる」と言っているか。形が違うものは false（推測しない）。 */
const isRetryableProviderError = (error: unknown): boolean =>
  error instanceof ProviderError && error.retryable

/**
 * 投入済みのジョブで、一時的な失敗なら問い合わせを予約し直す。
 * 予約したら結果を返し、そうでなければ `null`（呼び出し側が終端の失敗にする）。
 *
 * **予約し直すのは問い合わせ中だけ。** 投入前（`providerJobRef` が無い）の失敗は
 * まだ何も走っておらず、捨てても払ったものは無い。
 */
const reschedulePollAfterTransient = async (
  deps: GenerationProcessorDeps,
  job: GenerationJob,
  error: unknown,
  now: Date,
): Promise<GenerationOutcome | null> => {
  if (job.providerJobRef === null) return null
  if (!isRetryableProviderError(error)) return null

  // 普段の問い合わせと同じ方針（間隔の上限・諦める回数）を使う。
  const policy = pollPolicyForJob(deps.registry, job)
  const attempt = job.attempt + 1
  if (attempt > policy.maxAttempts) return null

  try {
    await deps.generationJobs.update(job.id, { attempt })
    const delayMs = pollDelayMs(attempt, policy)
    await deps.scheduler.reschedule({ generationJobId: job.id }, delayMs)
    deps.logger.warn(
      { jobId: job.id, attempt, err: error, at: now.toISOString() },
      '問い合わせが一時的に失敗した。投入済みなので捨てずに予約し直す',
    )
    return { state: 'polling', delayMs }
  } catch (cause) {
    // 予約し直せないなら、終端の失敗として扱わせる。握り潰さない。
    deps.logger.error({ jobId: job.id, err: cause }, '問い合わせの予約し直しに失敗した')
    return null
  }
}

/** DownloadError など、code を持つエラーからコードを取り出す。 */
const errorCodeOf = (error: unknown): string => {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  return error instanceof Error ? error.name : 'unknown_error'
}
