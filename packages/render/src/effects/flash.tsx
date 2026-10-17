import type { FlashParams } from '@ixa/domain'
import type React from 'react'
import { attackDecay, fitToClip } from './envelope.js'
import { OverlayBox, r4, type OverlayProps } from './overlay-box.js'

/**
 * フラッシュの濃さ。立ち上がって（attack）、なめらかに消える（decay）。尺が残っていても消えたまま。
 * 立ち上がりと消えるまでが尺より長ければ縮め、**最後のコマで必ず 0**にする。
 */
export const flashOpacity = (params: FlashParams, sec: number, durationSec: number, fps: number): number => {
  const k = fitToClip(params.attackSec + params.decaySec, durationSec, fps)
  return r4(params.intensity * attackDecay(sec, params.attackSec * k, params.decaySec * k))
}

/** フラッシュ。画面全体を 1 色で一瞬覆う。白で光らせ、黒で締める。 */
export const Flash: React.FC<OverlayProps<FlashParams>> = ({ params, time, video, layer }) => (
  <OverlayBox name="flash" video={video} layer={layer} style={{ backgroundColor: params.color, opacity: flashOpacity(params, time.sec, time.durationSec, time.fps) }} />
)
