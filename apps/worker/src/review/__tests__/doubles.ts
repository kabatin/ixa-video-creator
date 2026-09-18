import {
  MediaAsset as MediaAssetSchema,
  MediaAssetId as MediaAssetIdSchema,
  ModelId as ModelIdSchema,
  Project as ProjectSchema,
  ProjectId as ProjectIdSchema,
  ProviderId as ProviderIdSchema,
  ReviewFinding as ReviewFindingSchema,
  ReviewFindingId as ReviewFindingIdSchema,
  ReviewRun as ReviewRunSchema,
  ReviewRunId as ReviewRunIdSchema,
  Shot as ShotSchema,
  ShotId as ShotIdSchema,
  Take as TakeSchema,
  TakeId as TakeIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type CreateReviewFindingInput,
  type CreateReviewRunInput,
  type MediaAsset,
  type MediaAssetId,
  type Project,
  type ProjectId,
  type ReviewFinding,
  type ReviewRun,
  type ReviewRunId,
  type ReviewRunOutcome,
  type ReviewStatus,
  type Shot,
  type ShotId,
  type Take,
  type TakeId,
  type TakeUpdate,
} from '@ixa/domain'
import type { VisionReviewRequest, VisionReviewResult, VisionReviewer } from '@ixa/provider-llm'
import type { ReviewMeasurements } from '@ixa/review'
import { mediaKey, posterKey } from '@ixa/storage'
import pino from 'pino'
import type { MusicAnalysisLookup, RegenerationJobQueue } from '../processor.js'

/**
 * review プロセッサのテストダブル。
 * 実 DB / 実ストレージ / 実 ffmpeg / 実 LLM には接続しない。
 */

export const silentLogger = pino({ level: 'silent' })

export const CREATED_AT = new Date('2026-01-01T00:00:00.000Z')

/* --- エンティティ --- */

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
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  })

export const aShot = (project: Project, overrides: Partial<Shot> = {}): Shot =>
  ShotSchema.parse({
    id: newId(ShotIdSchema),
    projectId: project.id,
    sequenceId: null,
    locationId: null,
    order: 1000,
    code: 'shot_001',
    startSec: 0,
    durationSec: 3.75,
    sourceInSec: 0,
    description: 'ステージ中央でボーカルが歌い出す',
    dialogue: null,
    camera: {
      size: 'medium',
      angleH: 'front',
      angle: 'eye',
      lensMm: 35,
      movement: 'push_in',
      movementIntensity: 'subtle',
    },
    mood: 'energetic',
    continuityMode: 'independent',
    sourceType: { type: 'ai_video' },
    selectedTakeId: null,
    status: 'review',
    lockedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  })

const aSpec = (shotId: ShotId): unknown => ({
  specVersion: 1,
  shotId,
  sourceType: 'ai_video',
  prompt: 'cinematic stage, vocalist singing',
  negativePrompt: null,
  promptParts: {
    styleGuide: 'cinematic',
    shotDescription: 'ステージ中央でボーカルが歌い出す',
    identityAnchors: [],
    styleTokens: [],
    colorPalette: [],
    wardrobeTokens: [],
    cameraFragment: 'medium, from front, eye angle',
    moodFragment: 'energetic',
  },
  durationSec: 4,
  aspectRatio: '16:9',
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  seed: null,
  references: [],
  camera: {
    size: 'medium',
    angleH: 'front',
    angle: 'eye',
    lensMm: 35,
    movement: 'push_in',
    movementIntensity: 'subtle',
  },
})

export const aTake = (
  shot: Shot,
  mediaAssetId: MediaAssetId,
  overrides: Partial<Take> = {},
): Take =>
  TakeSchema.parse({
    id: newId(TakeIdSchema),
    shotId: shot.id,
    index: 1,
    mediaAssetId,
    spec: aSpec(shot.id),
    specHash: 'a'.repeat(64),
    providerId: ProviderIdSchema.parse('test'),
    modelId: ModelIdSchema.parse('test/model-a'),
    providerParams: { kind: 'http', request: {} },
    seedUsed: null,
    costUsd: 0.4,
    generationTimeSec: 42,
    parentTakeId: null,
    regenerationReason: null,
    reviewStatus: 'pending',
    humanVerdict: 'unreviewed',
    createdAt: CREATED_AT,
    ...overrides,
  })

/** ポスターフレームまで取り込み済みの動画。Stage 2 が判定に使える状態。 */
export const aVideoAsset = (project: Project, overrides: Partial<MediaAsset> = {}): MediaAsset => {
  const id = newId(MediaAssetIdSchema)
  const workspaceId = project.workspaceId
  return MediaAssetSchema.parse({
    id,
    workspaceId,
    projectId: project.id,
    kind: 'video',
    storageKey: mediaKey(workspaceId, id, 'mp4'),
    mimeType: 'video/mp4',
    bytes: 1024,
    checksumSha256: 'b'.repeat(64),
    probe: {
      durationSec: 4,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      codec: 'h264',
    },
    proxyKey: null,
    thumbnailKey: null,
    posterKeys: [0, 1, 2, 3, 4].map((index) => posterKey(workspaceId, id, index)),
    lastFrameAssetId: null,
    origin: { type: 'upload', uploadedBy: 'test' },
    tags: [],
    createdAt: CREATED_AT,
    ...overrides,
  })
}

/* --- リポジトリ --- */

export type InMemoryTakes = {
  findById(id: TakeId): Promise<Take | null>
  updateReview(takeId: TakeId, patch: TakeUpdate): Promise<Take>
  /** updateReview で書かれた reviewStatus。呼ばれていなければ null。 */
  readonly reviewStatusOf: (id: TakeId) => ReviewStatus | null
}

export const inMemoryTakes = (seed: readonly Take[] = []): InMemoryTakes => {
  let store: readonly Take[] = seed
  let written: Readonly<Record<string, ReviewStatus>> = {}

  return {
    reviewStatusOf: (id) => written[id] ?? null,
    findById: (id) => Promise.resolve(store.find((take) => take.id === id) ?? null),
    updateReview: (takeId, patch) => {
      const found = store.find((take) => take.id === takeId)
      if (found === undefined) return Promise.reject(new Error(`Take がありません: ${takeId}`))
      const updated: Take = { ...found, ...patch }
      store = store.map((take) => (take.id === takeId ? updated : take))
      if (patch.reviewStatus !== undefined) {
        written = { ...written, [takeId]: patch.reviewStatus }
      }
      return Promise.resolve(updated)
    },
  }
}

export const inMemoryShots = (seed: readonly Shot[] = []) => ({
  findById: (id: ShotId): Promise<Shot | null> =>
    Promise.resolve(seed.find((shot) => shot.id === id) ?? null),
})

export const inMemoryProjects = (seed: readonly Project[] = []) => ({
  findById: (id: ProjectId): Promise<Project | null> =>
    Promise.resolve(seed.find((project) => project.id === id) ?? null),
})

export const inMemoryMediaAssets = (seed: readonly MediaAsset[] = []) => ({
  findById: (id: MediaAssetId): Promise<MediaAsset | null> =>
    Promise.resolve(seed.find((asset) => asset.id === id) ?? null),
})

/** 解析なし。music レビュアが skip する経路を既定にする。 */
export const noMusicAnalysis = (): MusicAnalysisLookup => ({
  findByProject: () => Promise.resolve(null),
})

export type InMemoryReviews = {
  findLatestRunByTake(takeId: TakeId): Promise<ReviewRun | null>
  createRun(input: CreateReviewRunInput): Promise<ReviewRun>
  completeRun(id: ReviewRunId, outcome: ReviewRunOutcome): Promise<ReviewRun>
  addFindings(
    runId: ReviewRunId,
    inputs: readonly CreateReviewFindingInput[],
  ): Promise<ReviewFinding[]>
  readonly runs: () => readonly ReviewRun[]
  readonly findings: () => readonly ReviewFinding[]
}

export const inMemoryReviews = (seed: readonly ReviewRun[] = []): InMemoryReviews => {
  let runs: readonly ReviewRun[] = seed
  let findings: readonly ReviewFinding[] = []

  return {
    runs: () => runs,
    findings: () => findings,

    findLatestRunByTake: (takeId) => {
      const matched = runs.filter((run) => run.takeId === takeId)
      return Promise.resolve(matched.length === 0 ? null : (matched[matched.length - 1] as ReviewRun))
    },

    createRun: (input) => {
      const created = ReviewRunSchema.parse({
        ...input,
        reviewers: [...input.reviewers],
        id: newId(ReviewRunIdSchema),
        createdAt: CREATED_AT,
      })
      runs = [...runs, created]
      return Promise.resolve(created)
    },

    completeRun: (id, outcome) => {
      const found = runs.find((run) => run.id === id)
      if (found === undefined) return Promise.reject(new Error(`ReviewRun がありません: ${id}`))
      const updated: ReviewRun = { ...found, ...outcome }
      runs = runs.map((run) => (run.id === id ? updated : run))
      return Promise.resolve(updated)
    },

    addFindings: (runId, inputs) => {
      const created = inputs.map((input) =>
        ReviewFindingSchema.parse({
          ...input,
          reviewRunId: runId,
          id: newId(ReviewFindingIdSchema),
        }),
      )
      findings = [...findings, ...created]
      return Promise.resolve(created)
    },
  }
}

export const aReviewRun = (takeId: TakeId, overrides: Partial<ReviewRun> = {}): ReviewRun =>
  ReviewRunSchema.parse({
    id: newId(ReviewRunIdSchema),
    takeId,
    reviewers: ['technical'],
    status: 'done',
    verdict: 'pass',
    costUsd: 0,
    createdAt: CREATED_AT,
    ...overrides,
  })

/* --- 測定値 --- */

export const measurements = (
  take: Take,
  shot: Shot,
  overrides: Partial<ReviewMeasurements> = {},
): ReviewMeasurements => ({
  take,
  shot,
  video: { durationSec: 4, width: 1920, height: 1080, fps: 30, hasAudioStream: true },
  frames: [
    { atSec: 1, meanLuma: 0.4, colorRatios: { ixa_yellow: 0.2 } },
    { atSec: 2, meanLuma: 0.5, colorRatios: { ixa_yellow: 0.22 } },
  ],
  musicAnalysis: null,
  expected: { width: 1920, height: 1080, fps: 30 },
  brandColors: [],
  ...overrides,
})

/* --- 再生成キュー --- */

export type FakeRegenerationQueue = RegenerationJobQueue & {
  /** enqueue に渡された TakeId。**積まれていなければ空配列。** */
  readonly enqueued: () => readonly TakeId[]
}

export const fakeRegenerationQueue = (fail?: Error): FakeRegenerationQueue => {
  let enqueued: readonly TakeId[] = []
  return {
    enqueued: () => enqueued,
    enqueue: (takeId) => {
      if (fail !== undefined) return Promise.reject(fail)
      enqueued = [...enqueued, takeId]
      return Promise.resolve()
    },
  }
}

/* --- vision レビュア --- */

export type FakeVisionReviewer = VisionReviewer & {
  /** review に渡された依頼。**1 度も呼ばれていなければ空配列。** */
  readonly calls: () => readonly VisionReviewRequest[]
}

export const visionResult = (overrides: Partial<VisionReviewResult> = {}): VisionReviewResult => ({
  severity: 'warn',
  score: 0.6,
  message: '人物の髪型が参照と異なります',
  frameSec: 1.5,
  suggestedPromptDelta: 'short black hair, straight',
  ...overrides,
})

export const fakeVisionReviewer = (
  options: {
    readonly name?: string
    readonly supports?: VisionReviewer['supports']
    readonly result?: VisionReviewResult
    readonly costUsd?: number
    readonly fail?: Error
  } = {},
): FakeVisionReviewer => {
  let calls: readonly VisionReviewRequest[] = []
  return {
    name: options.name ?? 'fake-vision',
    supports: options.supports ?? ['identity'],
    calls: () => calls,
    review: (request) => {
      calls = [...calls, request]
      if (options.fail !== undefined) return Promise.reject(options.fail)
      return Promise.resolve({
        result: options.result ?? visionResult(),
        costUsd: options.costUsd ?? 0.02,
      })
    },
  }
}
