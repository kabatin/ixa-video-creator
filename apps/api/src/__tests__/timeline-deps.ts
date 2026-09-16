import type { MediaAsset, Project, Shot, Take, TimelineClip } from '@ixa/domain'
import { createMemoryStorage } from '@ixa/storage'
import type { RenderQueue, RenderRoutesDeps } from '../routes/renders.js'
import type { TimelineRoutesDeps } from '../routes/timeline.js'
import { aShot, aTake } from './fixtures.js'
import { createInMemoryMediaAssetRepository } from './in-memory-media-asset-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryShotRepository } from './in-memory-shot-repository.js'
import { createInMemoryTakeRepository } from './in-memory-take-repository.js'
import {
  aMediaAsset,
  createInMemoryMusicTrackRepository,
  createInMemoryRenderJobRepository,
  createInMemoryTimelineClipRepository,
  createInMemoryTransitionRepository,
  type InMemoryRenderJobRepository,
} from './in-memory-timeline-repositories.js'

/**
 * timeline / renders ルートのテスト用デプス。
 * 実 DB / 実ストレージ / 実キューには接続しない。
 */

export type TimelineFixture = {
  readonly project: Project
  readonly shots?: readonly Shot[]
  readonly takes?: readonly Take[]
  readonly mediaAssets?: readonly MediaAsset[]
  readonly clips?: readonly TimelineClip[]
  readonly transitions?: readonly import('@ixa/domain').Transition[]
}

export const timelineDeps = (fixture: TimelineFixture): TimelineRoutesDeps => ({
  projects: createInMemoryProjectRepository([fixture.project]),
  shots: createInMemoryShotRepository(fixture.shots ?? []),
  takes: createInMemoryTakeRepository(fixture.takes ?? []),
  transitions: createInMemoryTransitionRepository(fixture.transitions ?? []),
  timelineClips: createInMemoryTimelineClipRepository(fixture.clips ?? []),
  musicTracks: createInMemoryMusicTrackRepository(),
  mediaAssets: createInMemoryMediaAssetRepository(fixture.mediaAssets ?? []),
  storage: createMemoryStorage(),
})

/** 投入された RenderJobId を記録するだけのキュー。Redis には接続しない。 */
export type RecordingRenderQueue = RenderQueue & {
  readonly enqueued: () => readonly string[]
}

export const createRecordingRenderQueue = (): RecordingRenderQueue => {
  const enqueued: string[] = []
  return {
    enqueued: () => enqueued,
    enqueue: (renderJobId) => {
      enqueued.push(renderJobId)
      return Promise.resolve()
    },
  }
}

export type RenderFixtureDeps = RenderRoutesDeps & {
  readonly renderJobs: InMemoryRenderJobRepository
  readonly queue: RecordingRenderQueue
}

export const renderDeps = (fixture: TimelineFixture): RenderFixtureDeps => ({
  ...timelineDeps(fixture),
  renderJobs: createInMemoryRenderJobRepository(),
  queue: createRecordingRenderQueue(),
})

/**
 * 採用 Take と、その Take が指す MediaAsset を持つ Shot を作る。
 * VIDEO1 に載る最小構成。
 */
export const aShotWithTake = (project: Project, overrides: Partial<Shot> = {}) => {
  const asset = aMediaAsset({ workspaceId: project.workspaceId, projectId: project.id })
  const shot = aShot(project.id, overrides)
  const take = aTake(shot, 'f'.repeat(64), { mediaAssetId: asset.id })
  return { asset, take, shot: { ...shot, selectedTakeId: take.id } }
}
