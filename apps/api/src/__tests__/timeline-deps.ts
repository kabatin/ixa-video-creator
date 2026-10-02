import type { MediaAsset, MediaAssetId, Project, Shot, ShotId, Take, TimelineClip } from '@ixa/domain'
import { createMemoryStorage } from '@ixa/storage'
import type { RenderQueue, RenderRoutesDeps } from '../routes/renders.js'
import type { TimelineRoutesDeps } from '../routes/timeline.js'
import {
  aShot,
  aTake,
  createInMemoryMediaAssetRepository,
  createInMemoryShotReferenceRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
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
  /** 絵コンテの画像（最初のフレーム）。Take が無い Shot はこれを映す。 */
  readonly startFrames?: readonly { readonly shotId: ShotId; readonly mediaAssetId: MediaAssetId }[]
}

/** 最初のフレームを付けた参照の置き場。in-memory の create は呼んだ時点で積まれる。 */
const startFrameReferences = (frames: TimelineFixture['startFrames']) => {
  const references = createInMemoryShotReferenceRepository()
  for (const frame of frames ?? []) {
    void references.create({ ...frame, role: 'start_frame', weight: 1, order: 0, sourceKind: 'manual' })
  }
  return references
}

export const timelineDeps = (fixture: TimelineFixture): TimelineRoutesDeps => ({
  projects: createInMemoryProjectRepository([fixture.project]),
  shots: createInMemoryShotRepository(fixture.shots ?? []),
  takes: createInMemoryTakeRepository(fixture.takes ?? []),
  transitions: createInMemoryTransitionRepository(fixture.transitions ?? []),
  timelineClips: createInMemoryTimelineClipRepository(fixture.clips ?? []),
  musicTracks: createInMemoryMusicTrackRepository(),
  mediaAssets: createInMemoryMediaAssetRepository(fixture.mediaAssets ?? []),
  shotReferences: startFrameReferences(fixture.startFrames),
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
