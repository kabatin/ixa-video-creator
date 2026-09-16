import { DbNotFoundError } from '@ixa/db'
import type {
  GenerationJobRepository, MediaAssetRepository, ProjectRepository, ShotRepository, TakeRepository,
} from '@ixa/db'
import {
  Character as CharacterSchema,
  CharacterId as CharacterIdSchema,
  CharacterIdentityImage as CharacterIdentityImageSchema,
  CharacterIdentityImageId as CharacterIdentityImageIdSchema,
  CharacterLook as CharacterLookSchema,
  CharacterLookId as CharacterLookIdSchema,
  CharacterLookImage as CharacterLookImageSchema,
  CharacterLookImageId as CharacterLookImageIdSchema,
  CreateGenerationJobInput as CreateGenerationJobInputSchema,
  CreateMediaAssetInput as CreateMediaAssetInputSchema,
  CreateTakeInput as CreateTakeInputSchema,
  GenerationJob as GenerationJobSchema,
  GenerationJobId as GenerationJobIdSchema,
  MediaAsset as MediaAssetSchema,
  MediaAssetId as MediaAssetIdSchema,
  type MediaAssetId,
  ModelId as ModelIdSchema,
  Project as ProjectSchema,
  ProjectId as ProjectIdSchema,
  ProviderId as ProviderIdSchema,
  ReferenceRole as ReferenceRoleSchema,
  Shot as ShotSchema,
  ShotId as ShotIdSchema,
  Take as TakeSchema,
  TakeId as TakeIdSchema,
  TakeUpdate as TakeUpdateSchema,
  UpdateGenerationJobPatch as UpdateGenerationJobPatchSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type CharacterBundle,
  type GenerationContextSource,
  type GenerationJob,
  type MediaAsset,
  type Project,
  type Shot,
  type Take,
} from '@ixa/domain'
import type {
  ProviderJobStatus, VideoGenerationRequest, VideoModelCapabilities, VideoModelDescriptor,
  VideoProvider,
} from '@ixa/provider-core'
import pino from 'pino'
import type { GenerationJobData, MediaJobQueue, PollScheduler } from '../processor.js'

/**
 * worker のテスト用ダブル一式。
 * 実 DB / 実ストレージ / 実 Provider には接続しない。
 * packages/providers/video（スタブ Provider）にも依存しない。
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
      size: 'medium', angleH: 'front', angle: 'eye', lensMm: 35,
      movement: 'push_in', movementIntensity: 'subtle',
    },
    mood: 'energetic',
    sourceType: { type: 'ai_video' },
    selectedTakeId: null,
    status: 'generating',
    lockedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  })

export const TEST_CAPABILITIES: VideoModelCapabilities = {
  durations: { mode: 'enum', values: [4, 6, 8] },
  aspectRatios: ['16:9'],
  resolutions: [{ width: 1920, height: 1080 }],
  fps: [30],
  referenceImages: { max: 3, roles: [...ReferenceRoleSchema.options] },
  seed: true,
  negativePrompt: true,
  cameraControl: 'prompt',
  audioGeneration: false,
}

export const testModel = (id = 'test/model-a'): VideoModelDescriptor => ({
  id: ModelIdSchema.parse(id),
  providerId: ProviderIdSchema.parse('test'),
  label: id,
  capabilities: TEST_CAPABILITIES,
  qualities: {
    characterConsistency: 0.5, motion: 0.5, physics: 0.5,
    cameraControl: 0.5, promptAdherence: 0.5,
  },
  economics: { costPerSecondUsd: 0.1, typicalLatencySec: 60 },
})

export type TestProvider = VideoProvider & {
  readonly submitted: () => readonly VideoGenerationRequest[]
}

export const createTestProvider = (
  models: readonly VideoModelDescriptor[],
  statuses: readonly ProviderJobStatus[] = [],
): TestProvider => {
  const submitted: VideoGenerationRequest[] = []
  let polls = 0
  return {
    id: models[0]?.providerId ?? ProviderIdSchema.parse('test'),
    models,
    submitted: () => submitted,
    submit: (request) => {
      submitted.push(request)
      return Promise.resolve({
        providerId: request.model.providerId,
        modelId: request.model.id,
        ref: 'provider-job-1',
        submittedAt: new Date(),
      })
    },
    poll: () => {
      const status = statuses[Math.min(polls, statuses.length - 1)]
      polls += 1
      return Promise.resolve<ProviderJobStatus>(status ?? { state: 'pending', progress: null })
    },
    cancel: () => Promise.resolve(),
  }
}

export type RecordingScheduler = PollScheduler & {
  readonly scheduled: () => readonly { data: GenerationJobData; delayMs: number }[]
}

export const createRecordingScheduler = (): RecordingScheduler => {
  const scheduled: { data: GenerationJobData; delayMs: number }[] = []
  return {
    scheduled: () => scheduled,
    reschedule: (data, delayMs) => {
      scheduled.push({ data, delayMs })
      return Promise.resolve()
    },
  }
}

/** 投入された MediaAsset ID を記録するだけの media キュー。Redis には接続しない。 */
export type RecordingMediaQueue = MediaJobQueue & {
  readonly enqueued: () => readonly MediaAssetId[]
}

export const createRecordingMediaQueue = (): RecordingMediaQueue => {
  const enqueued: MediaAssetId[] = []
  return {
    enqueued: () => enqueued,
    enqueue: (mediaAssetId) => {
      enqueued.push(mediaAssetId)
      return Promise.resolve()
    },
  }
}

export const inMemoryProjects = (seed: readonly Project[]): ProjectRepository => ({
  findById: (id) => Promise.resolve(seed.find((p) => p.id === id) ?? null),
  findByWorkspace: (workspaceId) =>
    Promise.resolve(seed.filter((p) => p.workspaceId === workspaceId)),
  create: () => Promise.reject(new Error('未使用')),
  update: () => Promise.reject(new Error('未使用')),
  softDelete: () => Promise.resolve(),
})

export type InMemoryShots = ShotRepository & { readonly snapshot: () => readonly Shot[] }

export const inMemoryShots = (seed: readonly Shot[]): InMemoryShots => {
  let store: readonly Shot[] = [...seed]
  const replace = (id: string, patch: Partial<Shot>): Promise<Shot> => {
    const current = store.find((s) => s.id === id)
    if (current === undefined) return Promise.reject(new DbNotFoundError('Shot', id))
    const updated = ShotSchema.parse({ ...current, ...patch, updatedAt: new Date() })
    store = store.map((s) => (s.id === id ? updated : s))
    return Promise.resolve(updated)
  }
  return {
    snapshot: () => store,
    findById: (id) => Promise.resolve(store.find((s) => s.id === id) ?? null),
    findByProject: (projectId) => Promise.resolve(store.filter((s) => s.projectId === projectId)),
    create: () => Promise.reject(new Error('未使用')),
    // 生成ワーカーは Shot を作らない。使われたら気付けるよう落とす（既存の create と同じ）。
    createMany: () => Promise.reject(new Error('未使用')),
    update: (id, patch) => replace(id, patch as Partial<Shot>),
    softDelete: () => Promise.resolve(),
    selectTake: (shotId, takeId) => replace(shotId, { selectedTakeId: takeId }),
    updateStatus: (shotId, status) => replace(shotId, { status }),
  }
}

export type InMemoryTakes = TakeRepository & { readonly snapshot: () => readonly Take[] }

export const inMemoryTakes = (): InMemoryTakes => {
  let store: readonly Take[] = []
  return {
    snapshot: () => store,
    // 偽物なので projectId は見ず全 Take を合算する。テストは 1 プロジェクトしか作らない。
    sumCostByProject: () => Promise.resolve(store.reduce((sum, t) => sum + t.costUsd, 0)),
    sumCostByShot: (shotId) =>
      Promise.resolve(
        store.filter((t) => t.shotId === shotId).reduce((sum, t) => sum + t.costUsd, 0),
      ),
    findById: (id) => Promise.resolve(store.find((t) => t.id === id) ?? null),
    findByShot: (shotId) =>
      Promise.resolve(store.filter((t) => t.shotId === shotId).sort((a, b) => a.index - b.index)),
    create: (input) => {
      const validated = CreateTakeInputSchema.parse(input)
      const index =
        store.filter((t) => t.shotId === validated.shotId).reduce((m, t) => Math.max(m, t.index), 0) + 1
      const created = TakeSchema.parse({
        ...validated,
        id: validated.id ?? newId(TakeIdSchema),
        index,
        reviewStatus: 'pending',
        humanVerdict: 'unreviewed',
        createdAt: new Date(),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },
    updateReview: (takeId, patch) => {
      const current = store.find((t) => t.id === takeId)
      if (current === undefined) return Promise.reject(new DbNotFoundError('Take', takeId))
      const updated = TakeSchema.parse({ ...current, ...TakeUpdateSchema.parse(patch) })
      store = store.map((t) => (t.id === takeId ? updated : t))
      return Promise.resolve(updated)
    },
  }
}

export type InMemoryJobs = GenerationJobRepository & {
  readonly snapshot: () => readonly GenerationJob[]
}

export const inMemoryJobs = (seed: readonly GenerationJob[] = []): InMemoryJobs => {
  let store: readonly GenerationJob[] = [...seed]
  return {
    snapshot: () => store,
    findById: (id) => Promise.resolve(store.find((j) => j.id === id) ?? null),
    findByShot: (shotId) => Promise.resolve(store.filter((j) => j.shotId === shotId)),
    create: (input) => {
      const created = GenerationJobSchema.parse({
        ...CreateGenerationJobInputSchema.parse(input),
        id: newId(GenerationJobIdSchema),
        queuedAt: new Date(),
        startedAt: null,
        finishedAt: null,
      })
      store = [...store, created]
      return Promise.resolve(created)
    },
    update: (id, patch) => {
      const current = store.find((j) => j.id === id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('GenerationJob', id))
      const updated = GenerationJobSchema.parse({
        ...current,
        ...UpdateGenerationJobPatchSchema.parse(patch),
      })
      store = store.map((j) => (j.id === id ? updated : j))
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

/**
 * 参照を持つ GenerationContextSource のテストダブル。
 * Phase 1 の本番配線は空実装だが、Phase 2 で参照が入っても壊れないことを検証するために使う。
 */
export const contextWith = (
  characters: readonly CharacterBundle[] = [],
): GenerationContextSource => ({
  charactersForShot: () => Promise.resolve(characters),
  locationsForShot: () => Promise.resolve([]),
  manualReferencesForShot: () => Promise.resolve([]),
  previousShotLastFrame: () => Promise.resolve(null),
  startFrame: () => Promise.resolve(null),
})

/** 参照画像を 3 枚持つキャラクター束（canonical frame / 顔正面 / 衣装）。 */
export const aCharacterBundle = (): CharacterBundle => {
  const workspaceId = newId(WorkspaceIdSchema)
  const character = CharacterSchema.parse({
    id: newId(CharacterIdSchema),
    workspaceId,
    name: 'MIKU',
    displayName: '初号ボーカル',
    description: '',
    identityAnchors: ['teal twin tails'],
    styleTokens: ['anime'],
    colorPalette: ['#39C5BB'],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })
  const look = CharacterLookSchema.parse({
    id: newId(CharacterLookIdSchema),
    characterId: character.id,
    key: 'STAGE_A',
    name: 'ステージ衣装',
    era: null,
    description: '',
    wardrobeTokens: ['holographic jacket'],
    styleTokens: [],
    colorPalette: [],
    isDefault: true,
    canonicalFrameAssetId: newId(MediaAssetIdSchema),
  })
  return {
    character,
    look,
    identityImages: [
      CharacterIdentityImageSchema.parse({
        id: newId(CharacterIdentityImageIdSchema),
        characterId: character.id,
        mediaAssetId: newId(MediaAssetIdSchema),
        role: 'face_front',
        isPrimary: true,
        order: 0,
      }),
    ],
    lookImages: [
      CharacterLookImageSchema.parse({
        id: newId(CharacterLookImageIdSchema),
        lookId: look.id,
        mediaAssetId: newId(MediaAssetIdSchema),
        role: 'wardrobe',
        isPrimary: true,
        order: 0,
      }),
    ],
  }
}
