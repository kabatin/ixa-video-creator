import {
  createBrandAssetRepository,
  createMediaAssetRepository,
  createMusicAnalysisRepository,
  createMusicTrackRepository,
  createProjectRepository,
  createReviewRepository,
  createShotRepository,
  createTakeRepository,
  type DbClient,
} from '@ixa/db'
import type { MusicAnalysis, ProjectId } from '@ixa/domain'
import { brandReviewer, musicReviewer, technicalReviewer } from '@ixa/review'
import type { DeterministicReviewer } from '@ixa/review'
import { createStubVisionReviewer } from '@ixa/provider-llm'
import type { VisionReviewer } from '@ixa/provider-llm'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type {
  BrandColorTarget,
  MusicAnalysisLookup,
  RegenerationJobQueue,
  ReviewProcessorDeps,
} from './review/index.js'
import type { RegenerationProcessorDeps, RegenerationQueue } from './regeneration/index.js'

/**
 * レビューと再生成の依存を組み立てる（ADR-0005 / ARCHITECTURE.md §12・§13）。
 *
 * **具体的なレビュアの選択はここでのみ行う。** processor はポートの型しか知らない。
 */

/** Stage 1。ADR-0005 の決定的レビュア 3 本。 */
const DETERMINISTIC_REVIEWERS: readonly DeterministicReviewer[] = [
  technicalReviewer,
  musicReviewer,
  brandReviewer,
]

/**
 * ブランド色の要求。**hex はハードコードせず Asset Library から引く。**
 * 占有率の下限は「画面のどこかに入っていること」を見る程度に置く。ロゴの
 * 面積は構図で大きく変わるため、厳しくすると正しい絵まで落ちる。
 */
const BRAND_COLOR_MIN_RATIO = 0.002
const BRAND_COLOR_MAX_RATIO = 1

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * Project の Workspace に登録された色のブランド資産を、判定の要求へ写す。
 * 色が 1 つも登録されていなければ空を返し、brand レビュアは skip する。
 */
export const resolveBrandColorTargets = async (
  brandAssets: ReturnType<typeof createBrandAssetRepository>,
  projects: ReturnType<typeof createProjectRepository>,
  projectId: ProjectId,
): Promise<readonly BrandColorTarget[]> => {
  const project = await projects.findById(projectId)
  if (project === null) return []

  const assets = await brandAssets.findByWorkspace(project.workspaceId)
  return assets.flatMap((asset) =>
    asset.category === 'color' && asset.value !== null && HEX_COLOR.test(asset.value)
      ? [
          {
            key: asset.name,
            hex: asset.value,
            minRatio: BRAND_COLOR_MIN_RATIO,
            maxRatio: BRAND_COLOR_MAX_RATIO,
          },
        ]
      : [],
  )
}

/**
 * Project のマスター音源の解析を引く。
 *
 * `MusicAnalysisRepository` は MusicTrack 単位でしか引けないので、ここで
 * 「Project のマスター音源」を選ぶ。**尺を決めるのはマスター音源**なので、
 * ビート整合の基準もそこに揃える（無ければ先頭）。
 */
const createMusicAnalysisLookup = (db: DbClient): MusicAnalysisLookup => {
  const tracks = createMusicTrackRepository(db)
  const analyses = createMusicAnalysisRepository(db)

  return {
    findByProject: async (projectId): Promise<MusicAnalysis | null> => {
      const found = await tracks.findByProject(projectId)
      const master = found.find((track) => track.isMaster) ?? found[0]
      return master === undefined ? null : analyses.findByTrack(master.id)
    },
  }
}

export type ReviewWiring = {
  readonly review: ReviewProcessorDeps
  readonly regeneration: RegenerationProcessorDeps
}

export const createReviewWiring = (
  db: DbClient,
  storage: ObjectStorage,
  logger: Logger,
  queues: {
    /** review が fail した Take を回す先。積むだけで可否は判定しない。 */
    readonly regeneration: RegenerationJobQueue
    /** 再生成が通ったときに実際の生成を積む先。 */
    readonly generation: RegenerationQueue
  },
): ReviewWiring => {
  const takes = createTakeRepository(db)
  const shots = createShotRepository(db)
  const projects = createProjectRepository(db)
  const reviews = createReviewRepository(db)
  const brandAssets = createBrandAssetRepository(db)

  /**
   * Phase 4 はスタブのみ。実 LLM（Claude CLI）は運用設定が要るため、
   * 配線を差し替えるだけで移れる形にしてここでは繋がない（ADR-0014 と同じ考え方）。
   */
  const visionReviewers: readonly VisionReviewer[] = [createStubVisionReviewer()]

  return {
    review: {
      takes,
      shots,
      projects,
      mediaAssets: createMediaAssetRepository(db),
      musicAnalyses: createMusicAnalysisLookup(db),
      reviews,
      storage,
      regenerationQueue: queues.regeneration,
      deterministicReviewers: DETERMINISTIC_REVIEWERS,
      visionReviewers,
      workDir: process.env.REVIEW_WORK_DIR ?? '/tmp/ixa-review-work',
      logger,
      /**
       * **色は Asset Library から引く。** hex をここに書くと Project ごとに
       * 違うブランドを扱えなくなる。1 つも登録が無ければ brand レビュアは skip する。
       */
      brandColors: (projectId) => resolveBrandColorTargets(brandAssets, projects, projectId),
    },
    regeneration: {
      takes,
      shots,
      projects,
      reviews,
      queue: queues.generation,
      logger,
    },
  }
}
