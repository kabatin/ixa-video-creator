import { DbNotFoundError } from '@ixa/db'
import type { MediaAssetRepository, ProjectRepository, RenderJobRepository } from '@ixa/db'
import {
  CreateMediaAssetInput as CreateMediaAssetInputSchema,
  CreateRenderJobInput as CreateRenderJobInputSchema,
  MediaAsset as MediaAssetSchema,
  MediaAssetId as MediaAssetIdSchema,
  Project as ProjectSchema,
  ProjectId as ProjectIdSchema,
  RenderJob as RenderJobSchema,
  RenderJobId as RenderJobIdSchema,
  ShotId as ShotIdSchema,
  UpdateRenderJobPatch as UpdateRenderJobPatchSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type MediaAsset,
  type MediaAssetId,
  type Project,
  type RenderJob,
  type RenderPreset,
  type RenderResult,
  type TimelineDocument,
  type TimelineRenderer,
  type UpdateRenderJobPatch,
} from '@ixa/domain'
import pino from 'pino'
import type { RenderMediaJobQueue } from '../processor.js'

/**
 * render worker のテスト用ダブル一式。
 * 実 DB / 実ストレージ / 実レンダラ（Remotion）には接続しない。
 */

export const silentLogger = pino({ level: 'silent' })

export const aProject = (overrides: Partial<Project> = {}): Project =>
  ProjectSchema.parse({
    id: newId(ProjectIdSchema),
    workspaceId: newId(WorkspaceIdSchema),
    name: 'iXA CUP MUSIC VIDEO',
    fps: 30,
    resolution: { width: 1920, height: 1080 },
    aspectRatio: '16:9',
    durationSec: 116,
    budgetUsd: 500,
    styleGuide: 'cinematic',
    status: 'production',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  })

/** 最小の TimelineDocument。Shot 1 本ぶんの VIDEO1 を持つ。 */
export const aTimelineDocument = (
  overrides: Partial<TimelineDocument> = {},
): TimelineDocument => ({
  version: 1,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  durationSec: 4,
  video1: [
    {
      shotId: newId(ShotIdSchema),
      startSec: 0,
      durationSec: 4,
      mediaUrl: 'memory://media/ws/asset/original.mp4?op=get&expires=3600',
      inSec: 0,
    },
  ],
  transitions: [],
  clips: [],
  audio: [],
  ...overrides,
})

export type InMemoryProjects = ProjectRepository & {
  readonly replace: (project: Project) => void
}

export const inMemoryProjects = (seed: readonly Project[]): InMemoryProjects => {
  let store: readonly Project[] = [...seed]
  return {
    replace: (project) => {
      store = store.map((p) => (p.id === project.id ? project : p))
    },
    findById: (id) => Promise.resolve(store.find((p) => p.id === id) ?? null),
    findByWorkspace: (workspaceId) =>
      Promise.resolve(store.filter((p) => p.workspaceId === workspaceId)),
    create: () => Promise.reject(new Error('未使用')),
    update: () => Promise.reject(new Error('未使用')),
    softDelete: () => Promise.resolve(),
  }
}

export type InMemoryRenderJobs = RenderJobRepository & {
  readonly snapshot: () => readonly RenderJob[]
  /** 実際に DB へ飛んだ update の記録。進捗の間引きを数えるのに使う。 */
  readonly updates: () => readonly UpdateRenderJobPatch[]
}

export const inMemoryRenderJobs = (seed: readonly RenderJob[] = []): InMemoryRenderJobs => {
  let store: readonly RenderJob[] = seed.map((job) => RenderJobSchema.parse(job))
  const updates: UpdateRenderJobPatch[] = []

  return {
    snapshot: () => store,
    updates: () => updates,

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
      const validated = UpdateRenderJobPatchSchema.parse(patch)
      updates.push(validated)
      const updated = RenderJobSchema.parse({ ...current, ...validated })
      store = store.map((job) => (job.id === id ? updated : job))
      return Promise.resolve(updated)
    },
  }
}

export type InMemoryMediaAssets = MediaAssetRepository & {
  readonly snapshot: () => readonly MediaAsset[]
}

export const inMemoryMediaAssets = (): InMemoryMediaAssets => {
  let store: readonly MediaAsset[] = []
  return {
    snapshot: () => store,
    findById: (id) => Promise.resolve(store.find((a) => a.id === id) ?? null),
    findByWorkspace: (workspaceId) =>
      Promise.resolve(store.filter((a) => a.workspaceId === workspaceId)),
    findByProject: (projectId) => Promise.resolve(store.filter((a) => a.projectId === projectId)),
    findByChecksum: (checksum) =>
      Promise.resolve(store.find((a) => a.checksumSha256 === checksum) ?? null),
    create: (input) => {
      const validated = CreateMediaAssetInputSchema.parse(input)
      // 本物と同じく、同じ中身の素材は 1 つしか持てない（`media_assets_checksum_sha256_live_uidx`）。
      // これが無いと「同じ書き出しを 2 回すると保存で落ちる」をテストで再現できない。
      if (store.some((a) => a.checksumSha256 === validated.checksumSha256)) {
        return Promise.reject(new Error('duplicate key value violates unique constraint "media_assets_checksum_sha256_live_uidx"'))
      }
      const created = MediaAssetSchema.parse({
        ...validated,
        id: validated.id ?? newId(MediaAssetIdSchema),
        createdAt: new Date(),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },
    update: () => Promise.reject(new Error('未使用')),
    softDelete: () => Promise.resolve(),
  }
}

export type TestRenderer = TimelineRenderer & {
  /** render に渡された TimelineDocument。スナップショットを使っているかの検証に使う。 */
  readonly received: () => readonly TimelineDocument[]
  readonly calls: () => number
}

export type TestRendererOptions = {
  /** 出力ファイルのパス。呼び出し側が実ファイルを用意する。 */
  readonly outputPath: string
  /** onProgress を呼ぶ回数。既定 0。 */
  readonly progressSteps?: number
  /** 進捗の最大値。progressSteps 回かけてここまで進む。既定 1。 */
  readonly progressMax?: number
  /** render を失敗させる。 */
  readonly failWith?: Error
  readonly durationSec?: number
  readonly bytes?: number
}

/**
 * Remotion を起動しないレンダラのテストダブル。
 * **実レンダリングはしない**（遅いため）。`RenderResult.storageKey` は
 * 本物と同じくローカルの出力ファイルパスを返す。
 */
export const createTestRenderer = (options: TestRendererOptions): TestRenderer => {
  const received: TimelineDocument[] = []

  return {
    id: 'remotion',
    capabilities: { motionGraphics: true, textAnimation: true, perClipEffects: true },
    received: () => received,
    calls: () => received.length,

    render: (
      doc: TimelineDocument,
      _preset: RenderPreset,
      onProgress: (progress: number) => void,
    ): Promise<RenderResult> => {
      received.push(doc)

      const steps = options.progressSteps ?? 0
      const max = options.progressMax ?? 1
      for (let i = 1; i <= steps; i += 1) onProgress((max * i) / steps)

      if (options.failWith !== undefined) return Promise.reject(options.failWith)

      return Promise.resolve({
        storageKey: options.outputPath,
        durationSec: options.durationSec ?? doc.durationSec,
        bytes: options.bytes ?? 1024,
      })
    },
  }
}

export type RecordingMediaQueue = RenderMediaJobQueue & {
  /** 投入された MediaAssetId の記録。順序も保つ。 */
  readonly enqueued: () => readonly MediaAssetId[]
}

/**
 * media キューのテストダブル。Redis へは繋がない。
 * `failWith` を渡すと投入が必ず失敗する（投入失敗の扱いの検証用）。
 */
export const recordingMediaQueue = (failWith?: Error): RecordingMediaQueue => {
  const enqueued: MediaAssetId[] = []
  return {
    enqueued: () => enqueued,
    enqueue: (mediaAssetId) => {
      if (failWith !== undefined) return Promise.reject(failWith)
      enqueued.push(mediaAssetId)
      return Promise.resolve()
    },
  }
}
