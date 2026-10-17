import type { ShakeParams } from '@ixa/domain'
import { clamp01, lastFrameSec } from './envelope.js'
import type { FrameContribution } from './frame-layer.js'
import { smoothNoise } from './random.js'

/** 揺れの最大の振れ幅（映像の幅・高さに対する割合）と傾き。強さ 1 のとき。 */
const SHAKE_X = 0.025
const SHAKE_Y = 0.02
const SHAKE_ROTATE_DEG = 1.2

/**
 * 揺れ（frame の型）。頭で最も強く、尺の終わりへ向けて収まる。
 * 揺れた分だけ寄って、端の黒を見せない。乱れはクリップの ID から取った種で引く。
 */
export const shakeAt = (params: ShakeParams, seed: number, sec: number, durationSec: number, fps: number): FrameContribution => {
  // 最後のコマで揺れが止まりきる（次のコマで跳ねない）。
  const envelope = clamp01(sec / 0.03) * (1 - clamp01(sec / lastFrameSec(durationSec, fps))) ** 0.7
  const amp = params.intensity * envelope
  const position = sec * params.frequencyHz
  const x = SHAKE_X * amp * smoothNoise(seed, position)
  const y = SHAKE_Y * amp * smoothNoise(seed + 1, position)
  return {
    translateX: x,
    translateY: y,
    rotateDeg: SHAKE_ROTATE_DEG * amp * smoothNoise(seed + 2, position),
    scale: 1 + 2 * Math.max(Math.abs(x), Math.abs(y)) + 0.02 * amp,
  }
}
