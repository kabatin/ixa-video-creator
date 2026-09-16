import type {
  MediaAssetRepository,
  ProjectRepository,
  ReviewRepository,
  ShotRepository,
  TakeRepository,
} from '@ixa/db'
import {
  DETERMINISTIC_REVIEWERS,
  TakeId as TakeIdSchema,
  aggregateVerdict,
  type CreateReviewFindingInput,
  type MusicAnalysis,
  type ProjectId,
  type ReviewRunId,
  type ReviewStatus,
  type ReviewerType,
  type TakeId,
  type Verdict,
} from '@ixa/domain'
import type { VisionReviewer } from '@ixa/provider-llm'
import type { DeterministicReviewer } from '@ixa/review'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { BrandColorTarget } from './brand-color.js'
import { createFfmpegMeasurer, type TakeMeasurer } from './measure.js'
import { VisionStageError, runVisionStage } from './vision.js'

/**
 * review キューのジョブ処理（docs/ARCHITECTURE.md §12、ADR-0005）。
 *
 * - ジョブデータは ID のみ。実データは DB から読む（DB が真実。ADR-0008）
 * - 2 段構え。**Stage 1（決定的）に fail があれば Stage 2（vision LLM）を実行しない**
 * - 判定は追記のみ。やり直すときは新しい ReviewRun を作る
 */

export const ReviewJobData = z.object({ takeId: TakeIdSchema })
export type ReviewJobData = z.infer<typeof ReviewJobData>

/**
 * 楽曲解析を Project から 1 件引く口（music レビュア用）。
 *
 * `MusicAnalysisRepository` は MusicTrackId で引く形なので、そのままでは繋がらない。
 * Take から辿れるのは Project までで、そこからマスタートラックを選ぶのは配線側の判断になる。
 * 解析が無い Project では null を返すこと（music レビュアが skip になる）。
 */
export type MusicAnalysisLookup = {
  findByProject(projectId: ProjectId): Promise<MusicAnalysis | null>
}

/**
 * 再生成キューへジョブを積む口（docs/ARCHITECTURE.md §13）。
 *
 * BullMQ / Redis への依存は配線側に閉じ込める
 * （このモジュールは import しただけでは何も起こさない。CLAUDE.md 規約 7b）。
 * ジョブデータは ID のみ。実データは regeneration の processor が DB から読む（ADR-0008）。
 *
 * **再生成してよいかの判定はここでしない。** 上限・予算のガードは
 * `@ixa/domain` の `canRegenerate` を使う regeneration 側だけが持つ。
 * 判定を 2 箇所に書くと、片方だけ緩めた瞬間に無限ループになる。
 */
export type RegenerationJobQueue = {
  enqueue(takeId: TakeId): Promise<void>
}

/**
 * ブランド色の要求を Project ごとに引く口。
 *
 * **起動時に 1 度だけ解決してはいけない。** 色は Project（の Workspace）ごとに違うため、
 * 固定値にすると別の Project のブランドで判定してしまう。
 */
export type BrandColorLookup = (projectId: ProjectId) => Promise<readonly BrandColorTarget[]>

export type ReviewProcessorDeps = {
  readonly takes: Pick<TakeRepository, 'findById' | 'updateReview'>
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly musicAnalyses: MusicAnalysisLookup
  readonly reviews: Pick<
    ReviewRepository,
    'findLatestRunByTake' | 'createRun' | 'completeRun' | 'addFindings'
  >
  readonly storage: ObjectStorage
  /** verdict が fail の Take を再生成へ回す口。積むだけで、可否は判定しない。 */
  readonly regenerationQueue: RegenerationJobQueue
  /** Stage 1。順番は判定に影響しない（指摘は集約してから verdict を決める）。 */
  readonly deterministicReviewers: readonly DeterministicReviewer[]
  /** Stage 2。Stage 1 が fail したときは 1 度も呼ばれない。 */
  readonly visionReviewers: readonly VisionReviewer[]
  /** 一時ファイルの置き場。この下にジョブごとのディレクトリを掘る。 */
  readonly workDir: string
  readonly logger: Logger
  /**
   * ブランド色の要求。既定は空で、そのとき brand レビュアは skip する。
   * 色の定義（hex）は運用で変わるため、ここへ注入する。
   */
  readonly brandColors?: BrandColorLookup
  /** 測定器。既定は ffmpeg 実装。テストは実バイナリを起動せずに差し替える。 */
  readonly measurer?: TakeMeasurer
}

export type ReviewOutcome =
  | { readonly state: 'reviewed'; readonly verdict: Verdict }
  | { readonly state: 'skipped'; readonly reason: string }
  | { readonly state: 'failed'; readonly code: string }

/** code を持つエラー（FfmpegError / StorageError / VisionStageError）からコードを取り出す。 */
const errorCodeOf = (error: unknown): string => {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  return error instanceof Error ? error.name : 'unknown_error'
}

/** verdict を Take の reviewStatus へ写す。ReviewRun と Take で判定が食い違わないようにする。 */
const toReviewStatus = (verdict: Verdict): ReviewStatus => {
  switch (verdict) {
    case 'pass':
      return 'passed'
    case 'warn':
      return 'warned'
    case 'fail':
      return 'failed'
  }
}

/**
 * ReviewRun に記録する「依頼したレビュア」。
 *
 * `DeterministicReviewer` は純粋関数で名前を持たないため、
 * 個々がどの種別かはここから分からない。ADR-0005 が定める決定的レビュアの集合を
 * そのまま宣言し、**実際に何が指摘したかは findings 側で分かる**ようにしている。
 */
const plannedReviewers = (deps: ReviewProcessorDeps): readonly ReviewerType[] => {
  const deterministic = deps.deterministicReviewers.length > 0 ? DETERMINISTIC_REVIEWERS : []
  const vision = deps.visionReviewers.flatMap((reviewer) => reviewer.supports)
  return [...new Set([...deterministic, ...vision])]
}

/**
 * 失敗した実行を閉じる。ここで投げ直すと元の失敗が消えるため、ログに残して戻る。
 * running のまま残った ReviewRun は「まだ動いている」と読めてしまうので、必ず試みる。
 */
const failRun = async (
  deps: ReviewProcessorDeps,
  runId: ReviewRunId,
  costUsd: number,
): Promise<void> => {
  try {
    await deps.reviews.completeRun(runId, { status: 'failed', verdict: null, costUsd })
  } catch (error) {
    deps.logger.error({ runId, err: error }, 'ReviewRun を failed にできませんでした')
  }
}

/**
 * fail だった Take を再生成キューへ回す。
 *
 * **ここで失敗してもレビュー自体は失敗にしない。** 判定はすでに DB へ確定しており、
 * ジョブを失敗にしても再試行時には「レビュー済み」で skip されるだけで積み直せない。
 * 握り潰さず error で残し、再生成が動いていないことに気付けるようにする。
 */
const enqueueRegeneration = async (
  deps: ReviewProcessorDeps,
  takeId: TakeId,
  runId: ReviewRunId,
): Promise<void> => {
  try {
    await deps.regenerationQueue.enqueue(takeId)
    deps.logger.info({ takeId, runId }, '再生成キューへ積みました')
  } catch (error) {
    deps.logger.error(
      { takeId, runId, err: error },
      '再生成キューへ積めませんでした。この Take は再生成されません',
    )
  }
}

/**
 * review ジョブを 1 件処理する。
 *
 * Take / Shot / Project / MediaAsset が見つからない場合だけ throw する
 * （ジョブデータが実在しない行を指している＝再試行しても直らないが、
 * 握り潰すと原因が消えるため）。測定・判定の失敗は failed として返し、必ずログに残す。
 */
export const processReviewJob = async (
  deps: ReviewProcessorDeps,
  data: unknown,
): Promise<ReviewOutcome> => {
  const { takeId } = ReviewJobData.parse(data)

  const take = await deps.takes.findById(takeId)
  if (take === null) throw new Error(`Take が見つかりません: ${takeId}`)

  const shot = await deps.shots.findById(take.shotId)
  if (shot === null) throw new Error(`Take ${takeId} の Shot が見つかりません: ${take.shotId}`)

  const project = await deps.projects.findById(shot.projectId)
  if (project === null) {
    throw new Error(`Shot ${shot.id} の Project が見つかりません: ${shot.projectId}`)
  }

  const asset = await deps.mediaAssets.findById(take.mediaAssetId)
  if (asset === null) {
    throw new Error(`Take ${takeId} の MediaAsset が見つかりません: ${take.mediaAssetId}`)
  }

  const reviewers = plannedReviewers(deps)
  if (reviewers.length === 0) {
    deps.logger.warn({ takeId }, 'レビュアが 1 つも設定されていません')
    return { state: 'skipped', reason: 'no_reviewers' }
  }

  // 完了済みの実行があれば何もしない。BullMQ の再試行で二重に課金しないため。
  const latest = await deps.reviews.findLatestRunByTake(takeId)
  if (latest !== null && latest.status === 'done') {
    deps.logger.debug({ takeId, runId: latest.id }, 'レビュー済みなので何もしません')
    return { state: 'skipped', reason: 'already_reviewed' }
  }

  const run = await deps.reviews.createRun({
    takeId,
    reviewers: [...reviewers],
    status: 'running',
    verdict: null,
    costUsd: 0,
  })

  try {
    const measure = deps.measurer ?? createFfmpegMeasurer(deps)
    const measurements = await measure({
      take,
      shot,
      project,
      asset,
      musicAnalysis: await deps.musicAnalyses.findByProject(project.id),
      brandColors: deps.brandColors === undefined ? [] : await deps.brandColors(project.id),
    })

    const deterministicFindings = deps.deterministicReviewers.flatMap((review) =>
      review(measurements),
    )
    const blocked = deterministicFindings.some((finding) => finding.severity === 'fail')

    if (blocked) {
      deps.logger.info(
        { takeId, runId: run.id, findings: deterministicFindings.length },
        '決定的チェックが fail したため vision レビューを実行しません（ADR-0005）',
      )
    }

    // ここが ADR-0005 の要。fail が 1 つでもあれば Stage 2 へは進まない。
    const vision = blocked
      ? { findings: [] as readonly CreateReviewFindingInput[], costUsd: 0 }
      : await runVisionStage({
          shot,
          asset,
          reviewers: deps.visionReviewers,
          storage: deps.storage,
          logger: deps.logger,
        })

    const findings = [...deterministicFindings, ...vision.findings]
    await deps.reviews.addFindings(run.id, findings)

    const verdict = aggregateVerdict(findings)
    await deps.reviews.completeRun(run.id, {
      status: 'done',
      verdict,
      costUsd: vision.costUsd,
    })
    await deps.takes.updateReview(takeId, { reviewStatus: toReviewStatus(verdict) })

    deps.logger.info(
      { takeId, runId: run.id, verdict, findings: findings.length, costUsd: vision.costUsd },
      'レビューが完了しました',
    )

    // 再生成に回すのは fail だけ。warn は人が見る（ARCHITECTURE.md §13）。
    if (verdict === 'fail') await enqueueRegeneration(deps, takeId, run.id)

    return { state: 'reviewed', verdict }
  } catch (error) {
    const code = errorCodeOf(error)
    // 実際に払ったコストは失敗しても残す。0 にすると実績より安く見える。
    const costUsd = error instanceof VisionStageError ? error.costUsd : 0
    deps.logger.error({ takeId, runId: run.id, code, err: error }, 'レビューに失敗しました')
    await failRun(deps, run.id, costUsd)
    return { state: 'failed', code }
  }
}
