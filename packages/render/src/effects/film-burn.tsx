import type { FilmBurnParams } from '@ixa/domain'
import type React from 'react'
import { clamp01, fadeInOut } from './envelope.js'
import { OverlayBox, r4, type OverlayProps } from './overlay-box.js'
import { randomAt } from './random.js'

/**
 * フィルム焼け。画面の端から橙と赤の焼けが広がり、真ん中で白く飛んで引いていく。
 * 2 コマごとにわずかにちらつかせる（ちらつきも種で決まる）。
 */
export const filmBurnStyle = (params: FilmBurnParams, sec: number, durationSec: number, frame: number, seed: number): React.CSSProperties => {
  const envelope = fadeInOut(sec, durationSec, 0.4)
  const spread = r4(20 + 90 * envelope)
  const flicker = 0.85 + 0.15 * randomAt(seed, Math.floor(frame / 2))
  const edgeX = randomAt(seed, 1000) < 0.5 ? 0 : 100
  const edgeY = r4(100 * randomAt(seed, 1001))
  const core = r4(clamp01(envelope * 1.2 - 0.5) * 2 * 30)
  return {
    backgroundImage: [
      `radial-gradient(ellipse at ${String(edgeX)}% ${String(edgeY)}%, rgba(255, 250, 235, 0.95) 0%, rgba(255, 245, 225, 0) ${String(core)}%)`,
      `radial-gradient(ellipse at ${String(edgeX)}% ${String(edgeY)}%, rgba(255, 150, 40, 0.95) 0%, rgba(230, 40, 10, 0.8) ${String(r4(spread * 0.6))}%, rgba(120, 0, 0, 0) ${String(spread)}%)`,
    ].join(', '),
    mixBlendMode: 'screen',
    opacity: r4(params.intensity * envelope * flicker),
  }
}

export const FilmBurn: React.FC<OverlayProps<FilmBurnParams>> = ({ params, time, video, seed }) => (
  <OverlayBox name="film_burn" video={video} style={filmBurnStyle(params, time.sec, time.durationSec, time.frame, seed)} />
)
