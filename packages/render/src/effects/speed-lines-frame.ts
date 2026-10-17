import type { SpeedLinesParams } from '@ixa/domain'
import { fadeInOut } from './envelope.js'
import type { FrameContribution } from './frame-layer.js'

/**
 * スピード線が下の絵に掛ける分（ADR-0050）。**周りだけをぼかす**（中央の被写体は鮮明のまま。
 * どこを空けるかは `FrameFilter` の覆いが決める）。
 *
 * 光の筋を重ねるだけでは速さが出なかった（2026-10-17 の制作者のフィードバック「しょぼい」）。
 * 映画の速さは、画面の端が流れてブレることで出る。放射なら全方向に、横なら横向きにぼかす。
 * 値は映像の高さに対する割合（1080 の高さで、強さ 1 のとき放射 14px・横 26px）。
 */
const RADIAL_EDGE_BLUR = 0.013
const HORIZONTAL_EDGE_BLUR = 0.024

export const speedLinesFrameAt = (params: SpeedLinesParams, sec: number, durationSec: number): FrameContribution => {
  const amount = params.intensity * fadeInOut(sec, durationSec, 0.15)
  return params.direction === 'horizontal'
    ? { edgeBlurX: HORIZONTAL_EDGE_BLUR * amount }
    : { edgeBlur: RADIAL_EDGE_BLUR * amount }
}
