import type { ZoomPunchParams } from '@ixa/domain'
import { easeInQuad, easeOutCubic } from './envelope.js'
import type { FrameContribution } from './frame-layer.js'

/**
 * 寄りのパンチ（frame の型）。`peakAtSec` まで加速しながら寄り、そこから `decaySec` でなめらかに戻る。
 * `peakAtSec` が 0 なら頭のコマで寄りきっている（カットの頭・拍の頭に置く使い方）。
 */
export const zoomPunchAt = (params: ZoomPunchParams, sec: number): FrameContribution => {
  const extra = params.scale - 1
  if (sec < params.peakAtSec) return { scale: 1 + extra * easeInQuad(sec / params.peakAtSec) }
  return { scale: 1 + extra * (1 - easeOutCubic((sec - params.peakAtSec) / params.decaySec)) }
}
