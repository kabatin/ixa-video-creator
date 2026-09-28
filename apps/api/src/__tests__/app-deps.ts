import { createPhase1EmptyContextSource, ModelId, ProviderId, type GenerationJobId } from '@ixa/domain'
import { createProviderRegistry, type VideoProvider } from '@ixa/provider-core'
import { createMemoryStorage } from '@ixa/storage'
import type { AppDeps } from '../app.js'
import { createLogger } from '../logger.js'
import type { GenerationQueue } from '../routes/shots.js'
import { createInMemoryGenerationJobRepository } from './in-memory-generation-job-repository.js'
import {
  createInMemoryBrandAssetRepository,
  createInMemoryCharacterLookRepository,
  createInMemoryCharacterRepository,
  createInMemoryLocationRepository,
  createInMemoryMediaAssetRepository,
  createInMemoryShotCharacterRepository,
  createInMemoryShotReferenceRepository,
  createInMemoryImageJobRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryTextStyleRepository } from './in-memory-text-style-repository.js'
import {
  createInMemoryScriptRepository,
  createInMemorySequenceRepository,
} from './in-memory-script-repositories.js'
import { createInMemoryMusicAnalysisRepository } from './in-memory-music-analysis-repository.js'
import { createInMemoryReviewRepository } from './in-memory-review-repository.js'
import type { ReviewQueue } from '../routes/reviews.js'
import type { TakeId } from '@ixa/domain'
import type { AnalysisQueue } from '../routes/music.js'
import type { MusicTrackId } from '@ixa/domain'
import {
  createInMemoryMusicTrackRepository,
  createInMemoryRenderJobRepository,
  createInMemoryTimelineClipRepository,
  createInMemoryTransitionRepository,
} from './in-memory-timeline-repositories.js'
import type { RenderQueue } from '../routes/renders.js'
import type { RenderJobId } from '@ixa/domain'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryStoryboardDraftRepository } from './in-memory-storyboard-draft-repository.js'
import { createStubStoryboardDrafter } from '@ixa/provider-llm'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryMusicAnalysisFailureRepository } from './in-memory-music-analysis-failure-repository.js'

/** 投入されたジョブ ID を記録するだけのキュー。Redis には接続しない。 */
export type RecordingQueue = GenerationQueue & {
  readonly enqueued: () => readonly GenerationJobId[]
}

export const createRecordingQueue = (): RecordingQueue => {
  const enqueued: GenerationJobId[] = []
  return {
    enqueued: () => enqueued,
    enqueue: (generationJobId) => {
      enqueued.push(generationJobId)
      return Promise.resolve()
    },
  }
}

/**
 * createApp に渡す既定の依存一式。すべてインメモリで、実 DB / 実ストレージ /
 * 実 Provider には接続しない。テストは必要なものだけ差し替える。
 */
/** 投入された RenderJob ID を記録するだけのキュー。 */
export type RecordingRenderQueue = RenderQueue & {
  readonly enqueued: () => readonly RenderJobId[]
}

export const createRecordingRenderQueue = (): RecordingRenderQueue => {
  const enqueued: RenderJobId[] = []
  return {
    enqueued: () => enqueued,
    enqueue: (renderJobId) => {
      enqueued.push(renderJobId)
      return Promise.resolve()
    },
  }
}

/** 投入された MusicTrack ID を記録するだけのキュー。 */
export type RecordingAnalysisQueue = AnalysisQueue & {
  readonly enqueued: () => readonly MusicTrackId[]
}

export const createRecordingAnalysisQueue = (): RecordingAnalysisQueue => {
  const enqueued: MusicTrackId[] = []
  return {
    enqueued: () => enqueued,
    enqueue: (musicTrackId) => {
      enqueued.push(musicTrackId)
      return Promise.resolve()
    },
  }
}

/** 投入された Take ID を記録するだけのキュー。 */
export type RecordingReviewQueue = ReviewQueue & {
  readonly enqueued: () => readonly TakeId[]
}

export const createRecordingReviewQueue = (): RecordingReviewQueue => {
  const enqueued: TakeId[] = []
  return {
    enqueued: () => enqueued,
    enqueue: (takeId) => {
      enqueued.push(takeId)
      return Promise.resolve()
    },
  }
}

export const baseAppDeps = (providers: readonly VideoProvider[] = []): AppDeps => ({
  projects: createInMemoryProjectRepository(),
  mediaAssets: createInMemoryMediaAssetRepository(),
  shots: createInMemoryShotRepository(),
  takes: createInMemoryTakeRepository(),
  generationJobs: createInMemoryGenerationJobRepository(),
  registry: createProviderRegistry(providers),
  generationContext: createPhase1EmptyContextSource(),
  generationQueue: createRecordingQueue(),
  transitions: createInMemoryTransitionRepository(),
  timelineClips: createInMemoryTimelineClipRepository(),
  textStyles: createInMemoryTextStyleRepository(),
  musicTracks: createInMemoryMusicTrackRepository(),
  renderJobs: createInMemoryRenderJobRepository(),
  renderQueue: createRecordingRenderQueue(),
  characters: createInMemoryCharacterRepository(),
  looks: createInMemoryCharacterLookRepository(),
  shotCharacters: createInMemoryShotCharacterRepository(),
  shotReferences: createInMemoryShotReferenceRepository(),
  imageJobs: createInMemoryImageJobRepository(),
  // キューへは入れるだけ（作るのは worker）。テストでは記録もしない。
  imageQueue: { enqueue: () => Promise.resolve() },
  imageModel: { providerId: ProviderId.parse('stub-image'), modelId: ModelId.parse('stub/gemini-like-image') },
  brandAssets: createInMemoryBrandAssetRepository(),
  locations: createInMemoryLocationRepository(),
  scripts: createInMemoryScriptRepository(),
  storyboardDrafts: createInMemoryStoryboardDraftRepository(),
  editBatches: createInMemoryEditBatchRepository(),
  // テストは必ずスタブ。実 CLI が CI で走ることはない。
  storyboardDrafter: createStubStoryboardDrafter(),
  sequences: createInMemorySequenceRepository(),
  musicAnalyses: createInMemoryMusicAnalysisRepository(),
  musicAnalysisFailures: createInMemoryMusicAnalysisFailureRepository(),
  analysisQueue: createRecordingAnalysisQueue(),
  reviews: createInMemoryReviewRepository(),
  reviewQueue: createRecordingReviewQueue(),
  storage: createMemoryStorage(),
  // テストは同一オリジン想定なので CORS を無効にする
  corsOrigins: [],
  events: createInMemoryProjectEvents(),
  logger: createLogger('silent'),
})
