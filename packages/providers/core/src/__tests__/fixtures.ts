import { ModelId, ProviderId, ShotId } from '@ixa/domain'
import type { ShotGenerationSpec } from '@ixa/domain'
import type { VideoModelDescriptor } from '../provider.js'

export const modelId = (s: string): ModelId => ModelId.parse(s)
export const providerId = (s: string): ProviderId => ProviderId.parse(s)

/** テスト用。id / providerId は素の文字列で渡し、ここで branded 型へ変換する。 */
export type ModelOverrides = Omit<Partial<VideoModelDescriptor>, 'id' | 'providerId'> & {
  id: string
  providerId?: string
}

export const makeModel = (overrides: ModelOverrides): VideoModelDescriptor => ({
  id: modelId(overrides.id),
  providerId: providerId(overrides.providerId ?? 'test'),
  label: overrides.label ?? overrides.id,
  capabilities: {
    durations: { mode: 'range', min: 2, max: 15 },
    aspectRatios: ['16:9', '9:16'],
    resolutions: [{ width: 1920, height: 1080 }],
    fps: [30],
    referenceImages: { max: 9, roles: ['subject', 'wardrobe', 'start_frame', 'location'] },
    seed: true,
    negativePrompt: true,
    cameraControl: 'prompt',
    audioGeneration: false,
    ...overrides.capabilities,
  },
  qualities: {
    characterConsistency: 0.7,
    motion: 0.7,
    physics: 0.7,
    cameraControl: 0.7,
    promptAdherence: 0.7,
    ...overrides.qualities,
  },
  economics: { costPerSecondUsd: 0.1, typicalLatencySec: 60, ...overrides.economics },
})

export const makeSpec = (overrides: Partial<ShotGenerationSpec> = {}): ShotGenerationSpec => ({
  specVersion: 1,
  shotId: ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  sourceType: 'ai_video',
  prompt: 'takepi が勝利する',
  negativePrompt: null,
  promptParts: {
    styleGuide: '',
    shotDescription: 'takepi が勝利する',
    identityAnchors: [],
    styleTokens: [],
    colorPalette: [],
    wardrobeTokens: [],
    cameraFragment: 'medium closeup',
    moodFragment: null,
  },
  durationSec: 4,
  aspectRatio: '16:9',
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  seed: null,
  references: [],
  camera: {
    size: 'medium_closeup',
    angleH: null,
    angle: null,
    lensMm: null,
    movement: null,
    movementIntensity: null,
  },
  ...overrides,
})
