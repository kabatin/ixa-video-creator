import {
  AspectRatio,
  ModelId,
  PROJECT_FPS_OPTIONS,
  PROJECT_RESOLUTIONS,
  ProviderId,
} from '@ixa/domain'
import type { VideoModelCapabilities, VideoModelDescriptor } from '@ixa/provider-core'

/**
 * ローカルのスタブ Provider（ADR-0014）。
 * 一時的なモックではなく恒久的に維持する一級の実装であり、
 * **あえて実モデルに似た制約を宣言する**。制約の緩いスタブだと、
 * 尺の量子化（ADR-0011）と参照の切り詰めが本番切替時に初めて走ることになるため。
 */
export const STUB_PROVIDER_ID: ProviderId = ProviderId.parse('stub')

/**
 * スタブとして扱う Provider の ID 一覧（PHASE 6.3 の費用メーター）。
 *
 * **費用の出どころは過去の事実であって、今の設定ではない。** 今 registry にいる
 * Provider と突き合わせて判定すると、registry からスタブを外した瞬間に、
 * 過去に焼いた Take の $0 が「実測」に化ける。
 *
 * **スタブを足したらここにも足すこと。** 載せ忘れると、その Take は黙って
 * 「実測」に数えられ、偽の額が本物として表示される。
 * 一覧に無い ID がどう数えられたかは `CostMeter` が Provider 名で出すので、
 * 画面からも気付ける。
 */
export const STUB_PROVIDER_IDS: readonly ProviderId[] = Object.freeze([STUB_PROVIDER_ID])

export const STUB_VEO_LIKE_MODEL_ID: ModelId = ModelId.parse('stub/veo-like')
export const STUB_SEEDANCE_LIKE_MODEL_ID: ModelId = ModelId.parse('stub/seedance-like')

/**
 * どのスタブモデルでも共通の出力形式。**作品の設定で選べる形・大きさ・fps はすべて受ける**
 * （正は domain の `project-resolutions.ts`）。お試しは初めての人が選ぶ道で、画面で選べる大きさを
 * 断ると Take で止まる（2026-11-11）。実モデルを模すのは、尺の量子化と参照の切り詰めのほう。
 */
const SHARED_OUTPUT = {
  aspectRatios: [...AspectRatio.options],
  resolutions: AspectRatio.options.flatMap((aspectRatio) => PROJECT_RESOLUTIONS[aspectRatio]),
  fps: [...PROJECT_FPS_OPTIONS],
  audioGeneration: false,
} satisfies Pick<
  VideoModelCapabilities,
  'aspectRatios' | 'resolutions' | 'fps' | 'audioGeneration'
>

/** Veo を模す。尺は 4 / 6 / 8 秒の離散値しか出せず、参照画像は 3 枚まで。 */
export const stubVeoLikeModel: VideoModelDescriptor = {
  id: STUB_VEO_LIKE_MODEL_ID,
  providerId: STUB_PROVIDER_ID,
  label: 'お試し（AI を使わない仮の動画・4〜8 秒）',
  capabilities: {
    ...SHARED_OUTPUT,
    aspectRatios: [...SHARED_OUTPUT.aspectRatios],
    resolutions: SHARED_OUTPUT.resolutions.map((r) => ({ ...r })),
    fps: [...SHARED_OUTPUT.fps],
    durations: { mode: 'enum', values: [4, 6, 8] },
    /** 連続性フレームは開始画像として受ける（ADR-0016）。 */
    referenceImages: {
      max: 3,
      roles: ['subject', 'wardrobe', 'start_frame', 'previous_shot_last_frame'],
    },
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
  label: 'お試し（AI を使わない仮の動画・4〜15 秒）',
  capabilities: {
    ...SHARED_OUTPUT,
    aspectRatios: [...SHARED_OUTPUT.aspectRatios],
    resolutions: SHARED_OUTPUT.resolutions.map((r) => ({ ...r })),
    fps: [...SHARED_OUTPUT.fps],
    durations: { mode: 'range', min: 4, max: 15 },
    referenceImages: {
      max: 9,
      roles: [
        'subject', 'wardrobe', 'start_frame', 'previous_shot_last_frame',
        'end_frame', 'location', 'style',
      ],
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
