import type { FlashParams } from '@ixa/domain'
import type React from 'react'
import { attackDecay } from './envelope.js'
import { OverlayBox, r4, type OverlayProps } from './overlay-box.js'

/** フラッシュの濃さ。立ち上がって（attack）、なめらかに消える（decay）。尺が残っていても消えたまま。 */
export const flashOpacity = (params: FlashParams, sec: number): number =>
  r4(params.intensity * attackDecay(sec, params.attackSec, params.decaySec))

/** フラッシュ。画面全体を 1 色で一瞬覆う。白で光らせ、黒で締める。 */
export const Flash: React.FC<OverlayProps<FlashParams>> = ({ params, time, video }) => (
  <OverlayBox name="flash" video={video} style={{ backgroundColor: params.color, opacity: flashOpacity(params, time.sec) }} />
)
