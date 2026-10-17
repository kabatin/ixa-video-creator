import type { ZoomPunchParams } from '@ixa/domain'
import { easeInQuad, easeOutCubic, fitToClip } from './envelope.js'
import type { FrameContribution } from './frame-layer.js'

/**
 * 寄りのパンチ（frame の型）。`peakAtSec` まで加速しながら寄り、そこから `decaySec` でなめらかに戻る。
 * `peakAtSec` が 0 なら頭のコマで寄りきっている（カットの頭・拍の頭に置く使い方）。
 * 寄りきる時刻と戻るまでが尺より長ければ縮め、**最後のコマで必ず元の大きさ**に戻す。
 */
export const zoomPunchAt = (params: ZoomPunchParams, sec: number, durationSec: number, fps: number): FrameContribution => {
  const extra = params.scale - 1
  const k = fitToClip(params.peakAtSec + params.decaySec, durationSec, fps)
  const peak = params.peakAtSec * k
  if (sec < peak) return { scale: 1 + extra * easeInQuad(sec / peak) }
  return { scale: 1 + extra * (1 - easeOutCubic((sec - peak) / (params.decaySec * k))) }
}
