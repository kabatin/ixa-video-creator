import {
  Project as ProjectSchema,
  ProjectId as ProjectIdSchema,
  Shot as ShotSchema,
  ShotId as ShotIdSchema,
  Take as TakeSchema,
  TakeId as TakeIdSchema,
  MediaAssetId as MediaAssetIdSchema,
  ModelId as ModelIdSchema,
  ProviderId as ProviderIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type Project,
  type ProjectId,
  type Shot,
  type ShotGenerationSpec,
  type Take,
} from '@ixa/domain'

/** テスト用の Project。1920x1080 / 30fps / 16:9。 */
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
    styleGuide: 'cinematic, high contrast',
    status: 'production',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  })

/** テスト用の Shot。編集尺 3.75 秒（BPM128 で 2 小節）。 */
export const aShot = (projectId: ProjectId, overrides: Partial<Shot> = {}): Shot =>
  ShotSchema.parse({
    id: newId(ShotIdSchema),
    projectId,
    sequenceId: null,
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
    sourceType: { type: 'ai_video' },
    selectedTakeId: null,
    status: 'ready',
    lockedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  })

/** テスト用の Take。specHash は呼び出し側が指定する。 */
export const aTake = (shot: Shot, specHash: string, overrides: Partial<Take> = {}): Take =>
  TakeSchema.parse({
    id: newId(TakeIdSchema),
    shotId: shot.id,
    index: 1,
    mediaAssetId: newId(MediaAssetIdSchema),
    spec: minimalSpec(shot),
    specHash,
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
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  })

/** Take に埋める最小限の仕様。specHash の一致判定にしか使わない。 */
export const minimalSpec = (shot: Shot): ShotGenerationSpec => ({
  specVersion: 1,
  shotId: shot.id,
  sourceType: 'ai_video',
  prompt: shot.description,
  negativePrompt: null,
  promptParts: {
    styleGuide: '',
    shotDescription: shot.description,
    identityAnchors: [],
    styleTokens: [],
    colorPalette: [],
    wardrobeTokens: [],
    cameraFragment: '',
    moodFragment: shot.mood,
  },
  durationSec: 4,
  aspectRatio: '16:9',
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  seed: null,
  references: [],
  camera: shot.camera,
})
