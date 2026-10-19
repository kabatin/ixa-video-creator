import type { MediaAssetRepository, ShotRepository, TakeMotionAnalysisRepository, TakeRepository } from '@ixa/db'
import {
  MOTION_ANALYZER_VERSION,
  TakeId as TakeIdSchema,
  detectOnsets,
  fitEventsToTake,
  needsMotionAnalysis,
  onsetsToMomentEvents,
  snapToOnsets,
  sustainedSegments,
  type AiToolId,
  type MotionAnalysis,
  type MotionEvent,
  type MotionOnset,
  type Shot,
  type TakeId,
} from '@ixa/domain'
import type { MotionVisionAnalyzer } from '@ixa/provider-llm'
import type { Logger } from 'pino'
import { z } from 'zod'
import { withTempDir } from '../media/temp-dir.js'
import { MOTION_SAMPLE_FPS, type MotionMeasurement, type MotionMeasurer } from './measure.js'

/**
 * motion キューのジョブ処理（ADR-0054）。楽曲解析（`analysis/processor.ts`）と同じ作り:
 * - ジョブデータは ID のみ。実データは DB から読む
 * - 冪等。同じ版で成功した行があれば測らない（AI で見ていない行は、Claude に替わっていれば作り直す）
 * - 結果は追記のみ。失敗も理由を付けた行として残す（画面が「まだ終わっていない」と区別できるように）
 */

export const MotionJobData = z.object({ takeId: TakeIdSchema })
export type MotionJobData = z.infer<typeof MotionJobData>

export type MotionProcessorDeps = {
  readonly takes: Pick<TakeRepository, 'findById'>
  readonly shots: Pick<ShotRepository, 'findById'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly analyses: Pick<TakeMotionAnalysisRepository, 'findLatestByTake' | 'create'>
  readonly measurer: MotionMeasurer
  /** コマの帯を見る AI（Claude CLI）。「使う AI」の文章が Claude のときだけ呼ぶ。 */
  readonly vision: MotionVisionAnalyzer
  /** いま選んでいる文章の AI（ADR-0032）。判定するたびに読む。 */
  readonly textTool: () => Promise<AiToolId>
  /** 一時ファイルの置き場。この下にジョブごとのディレクトリを掘り、必ず消す。 */
  readonly workDir: string
  readonly logger: Logger
}

export type MotionOutcome =
  | { readonly state: 'skipped'; readonly reason: string }
  | { readonly state: 'analyzed'; readonly analysis: MotionAnalysis }
  | { readonly state: 'failed'; readonly message: string }

const TEMP_DIR_PREFIX = 'motion-job-'

/** どの段で落ちたかを、画面に出せる文にする。URL や例外の本文は入れない（ログにだけ残す）。 */
class MotionStageError extends Error {
  constructor(
    readonly userMessage: string,
    options: { readonly cause: unknown },
  ) {
    super(userMessage, options)
    this.name = 'MotionStageError'
  }
}

const MEASURE_FAILED = '動画から動きを測れませんでした。動画が壊れているか、見つかりません。'
const VISION_FAILED = 'AI（Claude）が動画のコマを判定できませんでした。時間をおいて、もう一度分析してください。'
const UNKNOWN_FAILED = '動きの分析に失敗しました。もう一度分析してください。'

const stage = async <T>(message: string, run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    throw new MotionStageError(message, { cause: error })
  }
}

type Analyzed = {
  readonly measurement: MotionMeasurement
  readonly onsets: readonly MotionOnset[]
  readonly events: readonly MotionEvent[]
  readonly visionUsed: boolean
  readonly costUsd: number
}

const analyze = async (
  deps: MotionProcessorDeps,
  shot: Shot,
  measurement: MotionMeasurement,
  visionAvailable: boolean,
  imageDir: string,
): Promise<Analyzed> => {
  const onsets = detectOnsets(measurement.energy, measurement.energyHopSec)
  if (!visionAvailable) {
    return { measurement, onsets, events: onsetsToMomentEvents(onsets), visionUsed: false, costUsd: 0 }
  }
  const outcome = await stage(VISION_FAILED, () =>
    deps.vision.analyze({
      strip: { label: 'コマの帯', path: measurement.strip.path },
      columns: measurement.strip.columns,
      frameTimesSec: [...measurement.strip.frameTimesSec],
      takeDurationSec: measurement.durationSec,
      onsets: [...onsets],
      segments: [...sustainedSegments(measurement.energy, measurement.energyHopSec)],
      description: shot.description,
      imageDir,
    }),
  )
  const events = snapToOnsets(fitEventsToTake(outcome.events, measurement.durationSec), onsets)
  return { measurement, onsets, events, visionUsed: true, costUsd: outcome.costUsd }
}

const recordFailure = async (deps: MotionProcessorDeps, takeId: TakeId, error: unknown): Promise<MotionOutcome> => {
  const message = error instanceof MotionStageError ? error.userMessage : UNKNOWN_FAILED
  deps.logger.error({ takeId, err: error }, '動きの分析に失敗しました')
  await deps.analyses.create({
    takeId,
    analyzerVersion: MOTION_ANALYZER_VERSION,
    status: 'failed',
    energyHopSec: 1 / MOTION_SAMPLE_FPS,
    energy: [],
    onsets: [],
    events: [],
    visionUsed: false,
    costUsd: 0,
    failureMessage: message,
  })
  return { state: 'failed', message }
}

/**
 * motion ジョブを 1 件処理する。Take・Shot・素材が見つからないときだけ投げる
 * （ジョブが実在しない行を指している）。測定と AI の失敗は失敗の行として残す。
 */
export const processMotionJob = async (deps: MotionProcessorDeps, data: unknown): Promise<MotionOutcome> => {
  const { takeId } = MotionJobData.parse(data)
  const take = await deps.takes.findById(takeId)
  if (take === null) throw new Error(`Take が見つかりません: ${takeId}`)
  const shot = await deps.shots.findById(take.shotId)
  if (shot === null) throw new Error(`Take ${takeId} の Shot が見つかりません: ${take.shotId}`)
  const asset = await deps.mediaAssets.findById(take.mediaAssetId)
  if (asset === null) throw new Error(`Take ${takeId} の動画の素材が見つかりません: ${take.mediaAssetId}`)

  const visionAvailable = (await deps.textTool()) === 'claude_cli'
  if (!needsMotionAnalysis(await deps.analyses.findLatestByTake(takeId), { visionAvailable })) {
    deps.logger.debug({ takeId }, '動きは分析済みなので何もしません')
    return { state: 'skipped', reason: 'already_analyzed' }
  }

  try {
    const result = await withTempDir(deps.workDir, TEMP_DIR_PREFIX, async (jobDir) => {
      const measurement = await stage(MEASURE_FAILED, () => deps.measurer(asset, jobDir))
      return analyze(deps, shot, measurement, visionAvailable, jobDir)
    })
    const analysis = await deps.analyses.create({
      takeId,
      analyzerVersion: MOTION_ANALYZER_VERSION,
      status: 'succeeded',
      energyHopSec: result.measurement.energyHopSec,
      energy: [...result.measurement.energy],
      onsets: [...result.onsets],
      events: [...result.events],
      visionUsed: result.visionUsed,
      costUsd: result.costUsd,
      failureMessage: null,
    })
    deps.logger.info(
      { takeId, onsets: analysis.onsets.length, events: analysis.events.length, visionUsed: analysis.visionUsed },
      '動きの分析が完了しました',
    )
    return { state: 'analyzed', analysis }
  } catch (error) {
    return recordFailure(deps, takeId, error)
  }
}

/** キューが打ち切ったとき（worker が落ちたなど）に、失敗の行を残す。 */
export const failInterruptedMotionJob = async (
  deps: MotionProcessorDeps,
  data: unknown,
  reason: string,
): Promise<void> => {
  const parsed = MotionJobData.safeParse(data)
  if (!parsed.success) return
  await recordFailure(deps, parsed.data.takeId, new Error(reason)).catch((error: unknown) => {
    deps.logger.error({ takeId: parsed.data.takeId, err: error }, '打ち切られた動きの分析を記録できませんでした')
  })
}
