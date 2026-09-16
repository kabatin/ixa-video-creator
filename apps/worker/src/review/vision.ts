import { cameraToPromptFragment, type CreateReviewFindingInput, type MediaAsset, type Shot } from '@ixa/domain'
import { posterFramePositions } from '@ixa/media'
import type { ReviewImage, VisionReviewResult, VisionReviewer } from '@ixa/provider-llm'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'

/**
 * Stage 2（vision LLM 判定）の実行（ADR-0005）。
 *
 * **Stage 1 が fail したときにここを呼ばない**のは processor の責任。
 * このモジュールは呼ばれたら必ず課金の発生する処理を行う。
 */

/** 署名付き URL の有効期限。DB には保存せず、ジョブごとに発行して捨てる（CLAUDE.md 規約 7）。 */
export const SIGNED_URL_TTL_SEC = 15 * 60

/**
 * 1 レビュアへ渡すフレームの上限。
 * ポスターフレームは全部で 5 枚あるが、全部を毎回 4 種類のレビュアへ送ると
 * 1 Take あたりの画像枚数が 20 枚になり、ADR-0005 が避けたかったコストに戻る。
 */
export const MAX_SUBJECT_FRAMES = 3

export type VisionStageInput = {
  readonly shot: Shot
  readonly asset: MediaAsset
  readonly reviewers: readonly VisionReviewer[]
  readonly storage: ObjectStorage
  readonly logger: Logger
}

export type VisionStageResult = {
  readonly findings: readonly CreateReviewFindingInput[]
  readonly costUsd: number
}

/**
 * Stage 2 の失敗。**そこまでに支払ったコストを持ったまま投げる。**
 * これを落とすと、失敗した ReviewRun の costUsd が 0 になり、実際より安く見える。
 */
export class VisionStageError extends Error {
  readonly code = 'vision_review_failed'

  constructor(
    message: string,
    readonly costUsd: number,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'VisionStageError'
  }
}

/**
 * 判定に使うフレームを選ぶ。
 * media キューが等間隔で抜いたポスターフレーム（`posterKeys`）をそのまま使い、
 * ここで ffmpeg を再度走らせない。無ければサムネイル 1 枚へ落とす。
 */
const subjectKeys = (asset: MediaAsset): readonly string[] => {
  if (asset.posterKeys.length > 0) return asset.posterKeys.slice(0, MAX_SUBJECT_FRAMES)
  return asset.thumbnailKey === null ? [] : [asset.thumbnailKey]
}

/**
 * ポスターフレームの秒数は media キューと同じ規則で復元できる（等間隔・端を避ける）。
 * 尺が分からなければ枚数だけのラベルにする。指摘の根拠を人が追えるようにするための情報で、
 * ここで推測値を秒数として出さない。
 */
const frameLabels = (asset: MediaAsset, count: number): readonly string[] => {
  const durationSec = asset.probe?.durationSec ?? null
  if (durationSec === null || durationSec <= 0 || asset.posterKeys.length === 0) {
    return Array.from({ length: count }, (_unused, index) => `frame#${index}`)
  }
  const positions = posterFramePositions(durationSec, asset.posterKeys.length)
  return Array.from(
    { length: count },
    (_unused, index) => `frame@${(positions[index] ?? 0).toFixed(3)}s`,
  )
}

const toImages = async (
  storage: ObjectStorage,
  asset: MediaAsset,
): Promise<readonly ReviewImage[]> => {
  const keys = subjectKeys(asset)
  const labels = frameLabels(asset, keys.length)
  return Promise.all(
    keys.map(async (key, index) => ({
      label: labels[index] ?? `frame#${index}`,
      url: await storage.signedGetUrl(key, SIGNED_URL_TTL_SEC),
    })),
  )
}

/**
 * 判定基準の文。Shot の演出指示をそのまま渡す。
 * 空文字を渡すと `VisionReviewRequest` の検証に落ちるため、最低でも Shot コードを入れる。
 */
export const buildCriteria = (shot: Shot): string => {
  const lines = [
    `shot ${shot.code}`,
    shot.description === '' ? null : `description: ${shot.description}`,
    `camera: ${cameraToPromptFragment(shot.camera)}`,
    shot.mood === null ? null : `mood: ${shot.mood}`,
    shot.dialogue === null ? null : `dialogue: ${shot.dialogue}`,
  ].filter((line): line is string => line !== null)
  return lines.join('\n')
}

/**
 * LLM の応答を指摘へ落とす。
 * `frameSec` は LLM が返す値なので、Seconds として通らない値は null にする
 * （負値や NaN をそのまま保存しようとすると、指摘全体の追記が落ちる）。
 */
const toFinding = (
  reviewer: CreateReviewFindingInput['reviewer'],
  result: VisionReviewResult,
): CreateReviewFindingInput => {
  const frameSec =
    result.frameSec !== null && Number.isFinite(result.frameSec) && result.frameSec >= 0
      ? result.frameSec
      : null
  return {
    reviewer,
    severity: result.severity,
    score: result.score,
    message: result.message,
    evidence: { frameSec, bbox: null, comparedAssetId: null },
    suggestedPromptDelta: result.suggestedPromptDelta,
  }
}

export const NO_FRAMES_MESSAGE =
  '抽出済みフレームが無いため判定していない（media ジョブでポスターフレームを作ること）'

/**
 * 判定できなかったことを指摘として残す。
 *
 * **「走らなかった」を「合格」に見せない。** 空で返すと `aggregateVerdict` が
 * pass を出し、7 レビュア中 4 つが一度も動いていないのに「レビュー済み・合格」に見える。
 * 実機で実際にそうなった。どの検査が飛んだかが分かるよう、レビュアごとに 1 件ずつ残す。
 */
const skippedFindings = (
  reviewers: readonly VisionReviewer[],
): readonly CreateReviewFindingInput[] =>
  [...new Set(reviewers.flatMap((reviewer) => reviewer.supports))].map((reviewer) => ({
    reviewer,
    severity: 'warn' as const,
    score: null,
    message: NO_FRAMES_MESSAGE,
    evidence: null,
    // 直すのはプロンプトではなく取り込み経路。再生成ループに差分を渡さない。
    suggestedPromptDelta: null,
  }))

/**
 * 注入された vision レビュアを順に走らせ、指摘と実コストを返す。
 *
 * 判定できるフレームが 1 枚も無ければ**呼ばない**。画像なしの依頼は
 * `VisionReviewRequest` の検証に落ちるうえ、画像を見ずに出た判定を残すべきでもない。
 * ただし黙って空を返すのではなく、判定していないことを warn として残す。
 */
export const runVisionStage = async (input: VisionStageInput): Promise<VisionStageResult> => {
  const subjects = await toImages(input.storage, input.asset)
  if (subjects.length === 0) {
    input.logger.warn(
      { mediaAssetId: input.asset.id, shotId: input.shot.id },
      '判定できるフレームが無いため vision レビューを実行しません',
    )
    return { findings: skippedFindings(input.reviewers), costUsd: 0 }
  }

  const criteria = buildCriteria(input.shot)
  const findings: CreateReviewFindingInput[] = []
  let costUsd = 0

  for (const reviewer of input.reviewers) {
    for (const reviewerType of reviewer.supports) {
      try {
        const outcome = await reviewer.review({
          reviewer: reviewerType,
          subjects: [...subjects],
          // 参照画像（人物 / 前 Shot の最終フレーム）の解決はアダプタ側の責務。
          references: [],
          criteria,
        })
        costUsd += outcome.costUsd
        findings.push(toFinding(reviewerType, outcome.result))
      } catch (error) {
        input.logger.error(
          { reviewer: reviewer.name, reviewerType, shotId: input.shot.id, err: error },
          'vision レビューに失敗しました',
        )
        throw new VisionStageError(
          `vision レビュア ${reviewer.name}（${reviewerType}）が失敗しました`,
          costUsd,
          { cause: error },
        )
      }
    }
  }

  return { findings, costUsd }
}
