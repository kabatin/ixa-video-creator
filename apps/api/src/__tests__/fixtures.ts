import {
  Character as CharacterSchema,
  CharacterId as CharacterIdSchema,
  CharacterIdentityImage as CharacterIdentityImageSchema,
  CharacterIdentityImageId as CharacterIdentityImageIdSchema,
  CharacterLook as CharacterLookSchema,
  CharacterLookId as CharacterLookIdSchema,
  CharacterLookImage as CharacterLookImageSchema,
  CharacterLookImageId as CharacterLookImageIdSchema,
  Project as ProjectSchema,
  ProjectId as ProjectIdSchema,
  MediaAssetId as MediaAssetIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type CharacterBundle,
  type GenerationContextSource,
  type Location,
  type MediaAssetId,
  type Project,
  type ShotReference,
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

/**
 * 参照を持つ GenerationContextSource のテストダブル。
 *
 * Phase 1 の本番配線は `createPhase1EmptyContextSource()`（空）だが、
 * Phase 2 で Character / Location のリポジトリが入ったときに壊れないよう、
 * 参照がある場合の経路も今のうちに検証しておく。
 */
export type ContextParts = {
  readonly characters?: readonly CharacterBundle[]
  readonly locations?: readonly Location[]
  readonly manualReferences?: readonly ShotReference[]
  readonly previousShotLastFrameId?: MediaAssetId | null
  readonly startFrameId?: MediaAssetId | null
}

export const createTestContextSource = (parts: ContextParts): GenerationContextSource => ({
  charactersForShot: () => Promise.resolve(parts.characters ?? []),
  locationsForShot: () => Promise.resolve(parts.locations ?? []),
  manualReferencesForShot: () => Promise.resolve(parts.manualReferences ?? []),
  previousShotLastFrame: () => Promise.resolve(parts.previousShotLastFrameId ?? null),
  startFrame: () => Promise.resolve(parts.startFrameId ?? null),
})

/** 参照画像を 3 枚持つキャラクター束（canonical frame / 顔正面 / 衣装）。 */
/** `projectId` は持ち主のプロジェクト（ADR-0034）。省略すると、どのプロジェクトとも違う ID。 */
export const aCharacterBundle = (projectId = newId(ProjectIdSchema)): CharacterBundle => {
  const workspaceId = newId(WorkspaceIdSchema)
  const character = CharacterSchema.parse({
    id: newId(CharacterIdSchema),
    workspaceId,
    projectId,
    name: 'MIKU',
    displayName: '初号ボーカル',
    description: '',
    identityAnchors: ['teal twin tails', 'slender build'],
    styleTokens: ['anime', 'cel shaded'],
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
    styleTokens: ['neon rim light'],
    colorPalette: ['#FFD200'],
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
