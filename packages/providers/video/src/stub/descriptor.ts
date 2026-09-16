import { ModelId, ProviderId } from '@ixa/domain'
import type { VideoModelCapabilities, VideoModelDescriptor } from '@ixa/provider-core'

/**
 * ローカルのスタブ Provider（ADR-0014）。
 * 一時的なモックではなく恒久的に維持する一級の実装であり、
 * **あえて実モデルに似た制約を宣言する**。制約の緩いスタブだと、
 * 尺の量子化（ADR-0011）と参照の切り詰めが本番切替時に初めて走ることになるため。
 */
export const STUB_PROVIDER_ID: ProviderId = ProviderId.parse('stub')

export const STUB_VEO_LIKE_MODEL_ID: ModelId = ModelId.parse('stub/veo-like')
export const STUB_SEEDANCE_LIKE_MODEL_ID: ModelId = ModelId.parse('stub/seedance-like')

/** どのスタブモデルでも共通の出力形式。FFmpeg 側の制約ではなく、実モデルを模した宣言。 */
const SHARED_OUTPUT = {
  aspectRatios: ['16:9', '9:16', '1:1'],
  resolutions: [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 1080, height: 1920 },
  ],
  fps: [24, 30],
  audioGeneration: false,
} as const satisfies Pick<
  VideoModelCapabilities,
  'aspectRatios' | 'resolutions' | 'fps' | 'audioGeneration'
>

/** Veo を模す。尺は 4 / 6 / 8 秒の離散値しか出せず、参照画像は 3 枚まで。 */
export const stubVeoLikeModel: VideoModelDescriptor = {
  id: STUB_VEO_LIKE_MODEL_ID,
  providerId: STUB_PROVIDER_ID,
  label: 'Stub (Veo-like)',
  capabilities: {
    ...SHARED_OUTPUT,
    aspectRatios: [...SHARED_OUTPUT.aspectRatios],
    resolutions: SHARED_OUTPUT.resolutions.map((r) => ({ ...r })),
    fps: [...SHARED_OUTPUT.fps],
    durations: { mode: 'enum', values: [4, 6, 8] },
    referenceImages: { max: 3, roles: ['subject', 'wardrobe', 'start_frame'] },
    seed: true,
    negativePrompt: false,
    cameraControl: 'prompt',
  },
  qualities: {
    characterConsistency: 0.8,
    motion: 0.85,
    physics: 0.8,
    cameraControl: 0.5,
    promptAdherence: 0.85,
  },
  economics: { costPerSecondUsd: 0, typicalLatencySec: 2 },
}

/** Seedance を模す。尺は 4〜15 秒の連続値、参照画像は 9 枚まで。 */
export const stubSeedanceLikeModel: VideoModelDescriptor = {
  id: STUB_SEEDANCE_LIKE_MODEL_ID,
  providerId: STUB_PROVIDER_ID,
  label: 'Stub (Seedance-like)',
  capabilities: {
    ...SHARED_OUTPUT,
    aspectRatios: [...SHARED_OUTPUT.aspectRatios],
    resolutions: SHARED_OUTPUT.resolutions.map((r) => ({ ...r })),
    fps: [...SHARED_OUTPUT.fps],
    durations: { mode: 'range', min: 4, max: 15 },
    referenceImages: {
      max: 9,
      roles: ['subject', 'wardrobe', 'start_frame', 'end_frame', 'location', 'style'],
    },
    seed: true,
    negativePrompt: false,
    cameraControl: 'prompt',
  },
  qualities: {
    characterConsistency: 0.75,
    motion: 0.8,
    physics: 0.7,
    cameraControl: 0.4,
    promptAdherence: 0.8,
  },
  economics: { costPerSecondUsd: 0, typicalLatencySec: 3 },
}

export const stubVideoModels: readonly VideoModelDescriptor[] = [
  stubVeoLikeModel,
  stubSeedanceLikeModel,
]
