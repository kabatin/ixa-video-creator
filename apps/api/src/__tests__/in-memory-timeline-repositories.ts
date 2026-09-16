import { DbNotFoundError } from '@ixa/db'
import type {
  MusicTrackRepository, RenderJobRepository, TimelineClipRepository, TransitionRepository,
} from '@ixa/db'
import {
  CreateMusicTrackInput as CreateMusicTrackInputSchema,
  CreateRenderJobInput as CreateRenderJobInputSchema,
  CreateTimelineClipInput as CreateTimelineClipInputSchema,
  CreateTransitionInput as CreateTransitionInputSchema,
  MediaAsset as MediaAssetSchema,
  MediaAssetId as MediaAssetIdSchema,
  MusicTrack as MusicTrackSchema,
  MusicTrackId as MusicTrackIdSchema,
  RenderJob as RenderJobSchema,
  RenderJobId as RenderJobIdSchema,
  TimelineClip as TimelineClipSchema,
  TimelineClipId as TimelineClipIdSchema,
  Transition as TransitionSchema,
  TransitionId as TransitionIdSchema,
  UpdateRenderJobPatch as UpdateRenderJobPatchSchema,
  UpdateTimelineClipPatch as UpdateTimelineClipPatchSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type MediaAsset,
  type MusicTrack,
  type RenderJob,
  type TimelineClip,
  type Transition,
} from '@ixa/domain'

/**
 * タイムライン / レンダリング系のインメモリリポジトリとフィクスチャ。
 * 実 DB / 実ストレージには接続しない。実装と同じく Domain 型のみを返し、
 * 保持する値は毎回作り直す（破壊的変更をしない）。
 */

export type InMemoryRenderJobRepository = RenderJobRepository & {
  readonly snapshot: () => readonly RenderJob[]
}

export const createInMemoryRenderJobRepository = (
  seed: readonly RenderJob[] = [],
): InMemoryRenderJobRepository => {
  let store: readonly RenderJob[] = seed.map((job) => RenderJobSchema.parse(job))

  return {
    snapshot: () => store,

    findById: (id) => Promise.resolve(store.find((job) => job.id === id) ?? null),

    findByProject: (projectId) =>
      Promise.resolve(store.filter((job) => job.projectId === projectId)),

    create: (input) => {
      const created = RenderJobSchema.parse({
        ...CreateRenderJobInputSchema.parse(input),
        id: newId(RenderJobIdSchema),
        outputAssetId: null,
        error: null,
        createdAt: new Date(),
        finishedAt: null,
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = store.find((job) => job.id === id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('RenderJob', id))
      const updated = RenderJobSchema.parse({
        ...current,
        ...UpdateRenderJobPatchSchema.parse(patch),
      })
      store = store.map((job) => (job.id === id ? updated : job))
      return Promise.resolve(updated)
    },
  }
}

export type InMemoryTimelineClipRepository = TimelineClipRepository & {
  readonly snapshot: () => readonly TimelineClip[]
}

export const createInMemoryTimelineClipRepository = (
  seed: readonly TimelineClip[] = [],
): InMemoryTimelineClipRepository => {
  let store: readonly TimelineClip[] = seed.map((clip) => TimelineClipSchema.parse(clip))

  return {
    snapshot: () => store,

    findByProject: (projectId) =>
      Promise.resolve(store.filter((clip) => clip.projectId === projectId)),

    create: (input) => {
      const created = TimelineClipSchema.parse({
        ...CreateTimelineClipInputSchema.parse(input),
        id: newId(TimelineClipIdSchema),
        createdAt: new Date(),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = store.find((clip) => clip.id === id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('TimelineClip', id))
      const updated = TimelineClipSchema.parse({
        ...current,
        ...UpdateTimelineClipPatchSchema.parse(patch),
      })
      store = store.map((clip) => (clip.id === id ? updated : clip))
      return Promise.resolve(updated)
    },

    softDelete: (id) => {
      if (store.find((clip) => clip.id === id) === undefined) {
        return Promise.reject(new DbNotFoundError('TimelineClip', id))
      }
      store = store.filter((clip) => clip.id !== id)
      return Promise.resolve()
    },
  }
}

export type InMemoryTransitionRepository = TransitionRepository & {
  readonly snapshot: () => readonly Transition[]
}

export const createInMemoryTransitionRepository = (
  seed: readonly Transition[] = [],
): InMemoryTransitionRepository => {
  let store: readonly Transition[] = seed.map((t) => TransitionSchema.parse(t))

  return {
    snapshot: () => store,

    findByProject: (projectId) => Promise.resolve(store.filter((t) => t.projectId === projectId)),

    create: (input) => {
      const created = TransitionSchema.parse({
        ...CreateTransitionInputSchema.parse(input),
        id: newId(TransitionIdSchema),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    delete: (id) => {
      if (store.find((t) => t.id === id) === undefined) {
        return Promise.reject(new DbNotFoundError('Transition', id))
      }
      store = store.filter((t) => t.id !== id)
      return Promise.resolve()
    },
  }
}

export type InMemoryMusicTrackRepository = MusicTrackRepository & {
  readonly snapshot: () => readonly MusicTrack[]
}

export const createInMemoryMusicTrackRepository = (
  seed: readonly MusicTrack[] = [],
): InMemoryMusicTrackRepository => {
  let store: readonly MusicTrack[] = seed.map((track) => MusicTrackSchema.parse(track))

  return {
    snapshot: () => store,

    findByProject: (projectId) =>
      Promise.resolve(store.filter((track) => track.projectId === projectId)),

    create: (input) => {
      const created = MusicTrackSchema.parse({
        ...CreateMusicTrackInputSchema.parse(input),
        id: newId(MusicTrackIdSchema),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },
  }
}

/** テスト用の MediaAsset。既定は 1 秒の動画（アップロード由来）。 */
export const aMediaAsset = (overrides: Partial<MediaAsset> = {}): MediaAsset =>
  MediaAssetSchema.parse({
    id: newId(MediaAssetIdSchema),
    workspaceId: newId(WorkspaceIdSchema),
    projectId: null,
    kind: 'video',
    storageKey: 'media/ws/asset/original.mp4',
    mimeType: 'video/mp4',
    bytes: 1024,
    checksumSha256: 'a'.repeat(64),
    probe: null,
    proxyKey: null,
    thumbnailKey: null,
    posterKeys: [],
    origin: { type: 'upload', uploadedBy: 'test' },
    tags: [],
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  })
