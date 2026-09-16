import { createPhase1EmptyContextSource, type GenerationJobId } from '@ixa/domain'
import { createProviderRegistry, type VideoProvider } from '@ixa/provider-core'
import { createMemoryStorage } from '@ixa/storage'
import type { AppDeps } from '../app.js'
import { createLogger } from '../logger.js'
import type { GenerationQueue } from '../routes/shots.js'
import { createInMemoryGenerationJobRepository } from './in-memory-generation-job-repository.js'
import { createInMemoryMediaAssetRepository } from './in-memory-media-asset-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryShotRepository } from './in-memory-shot-repository.js'
import { createInMemoryTakeRepository } from './in-memory-take-repository.js'
import {
  createInMemoryMusicTrackRepository,
  createInMemoryRenderJobRepository,
  createInMemoryTimelineClipRepository,
  createInMemoryTransitionRepository,
} from './in-memory-timeline-repositories.js'
import type { RenderQueue } from '../routes/renders.js'
import type { RenderJobId } from '@ixa/domain'

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
  musicTracks: createInMemoryMusicTrackRepository(),
  renderJobs: createInMemoryRenderJobRepository(),
  renderQueue: createRecordingRenderQueue(),
  storage: createMemoryStorage(),
  logger: createLogger('silent'),
})
