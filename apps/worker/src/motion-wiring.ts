import {
  createMediaAssetRepository,
  createShotRepository,
  createTakeMotionAnalysisRepository,
  createTakeRepository,
  type DbClient,
} from '@ixa/db'
import type { AiToolId } from '@ixa/domain'
import { createClaudeCliMotionAnalyzer } from '@ixa/provider-llm'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { createFfmpegMotionMeasurer, type MotionProcessorDeps } from './motion/index.js'

/**
 * Take の動きの分析の依存を組み立てる（ADR-0054）。コマの帯を見るのは Claude CLI だけで、
 * 「使う AI」の文章が Claude 以外なら processor が呼ばない（山だけの案にする）。
 */
export const createMotionWiring = (input: {
  readonly db: DbClient
  readonly storage: ObjectStorage
  readonly logger: Logger
  /** いま選んでいる文章の AI（ADR-0032）。判定するたびに読む。 */
  readonly textTool: () => Promise<AiToolId>
}): MotionProcessorDeps => ({
  takes: createTakeRepository(input.db),
  shots: createShotRepository(input.db),
  mediaAssets: createMediaAssetRepository(input.db),
  analyses: createTakeMotionAnalysisRepository(input.db),
  measurer: createFfmpegMotionMeasurer({ storage: input.storage }),
  vision: createClaudeCliMotionAnalyzer(),
  textTool: input.textTool,
  workDir: process.env.MOTION_WORK_DIR ?? '/tmp/ixa-motion-work',
  logger: input.logger,
})
