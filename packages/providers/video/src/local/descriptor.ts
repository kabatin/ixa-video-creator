import { ModelId, ProviderId } from '@ixa/domain'
import type { VideoModelDescriptor } from '@ixa/provider-core'

/**
 * ローカルの画像→動画（ADR-0025）。**最初のフレームの画像を ffmpeg で動かすだけ。**
 *
 * 生成モデルではないので絵は変わらない。他のツールで作った絵や撮った写真を Shot に持ち込み、
 * 今の Take・採用・レビューの流れに載せるための口。費用は 0 で、ネットワークも鍵も要らない。
 * **AUTO の候補にしない**（`routable: false`）。最初のフレームを付けただけで AUTO が
 * こちらへ切り替わると、生成を頼んだつもりが画像を動かすだけになる。
 */
export const LOCAL_PROVIDER_ID: ProviderId = ProviderId.parse('local')

export const LOCAL_STILL_MOTION_MODEL_ID: ModelId = ModelId.parse('local/still-motion')

export const localStillMotionModel: VideoModelDescriptor = {
  id: LOCAL_STILL_MOTION_MODEL_ID,
  providerId: LOCAL_PROVIDER_ID,
  label: '画像から動画（ローカル・無料）',
  capabilities: {
    // 1 枚の画像から何秒でも作れる。尺の量子化を起こさない。
    durations: { mode: 'range', min: 0.5, max: 60 },
    aspectRatios: ['16:9', '9:16', '1:1'],
    resolutions: [
      { width: 3840, height: 2160 },
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 1080, height: 1920 },
      { width: 1080, height: 1080 },
    ],
    fps: [24, 25, 30],
    referenceImages: { max: 1, roles: ['start_frame'] },
    requiresStartFrame: true,
    seed: true,
    negativePrompt: false,
    cameraControl: 'preset',
    audioGeneration: false,
  },
  // 絵は入力のまま。動きは寄り・引き・横移動だけ。
  qualities: {
    characterConsistency: 1,
    motion: 0.2,
    physics: 0.1,
    cameraControl: 0.5,
    promptAdherence: 0,
  },
  economics: { costPerSecondUsd: 0, typicalLatencySec: 5 },
  routable: false,
}

export const localVideoModels: readonly VideoModelDescriptor[] = [localStillMotionModel]
