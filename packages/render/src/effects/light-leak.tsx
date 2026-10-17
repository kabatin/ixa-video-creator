import type { LightLeakParams } from '@ixa/domain'
import type React from 'react'
import { fadeInOut } from './envelope.js'
import { OverlayBox, r4, type OverlayProps } from './overlay-box.js'
import { randomAt } from './random.js'

/** 光のかたまりの数。多いと画面が白く濁る。 */
const BLOBS = 3

/**
 * 光漏れ。色合い（hue）の光のかたまりが画面の端からゆっくり流れる。`screen` で重ねるので暗部は残る。
 * 光の置き場と流れる向きは種で決まる。
 */
export const lightLeakStyle = (params: LightLeakParams, sec: number, durationSec: number, seed: number): React.CSSProperties => {
  const progress = durationSec > 0 ? sec / durationSec : 0
  const gradients = Array.from({ length: BLOBS }, (_, i) => {
    const x = r4(-10 + 120 * ((randomAt(seed, i * 4) + progress * (0.4 + randomAt(seed, i * 4 + 1))) % 1.2))
    const y = r4(100 * randomAt(seed, i * 4 + 2))
    const size = r4(35 + 30 * randomAt(seed, i * 4 + 3))
    const hue = r4((params.hue + i * 18) % 360)
    return `radial-gradient(circle at ${String(x)}% ${String(y)}%, hsla(${String(hue)}, 95%, 60%, 0.9) 0%, hsla(${String(hue)}, 95%, 55%, 0) ${String(size)}%)`
  })
  return {
    backgroundImage: gradients.join(', '),
    mixBlendMode: 'screen',
    opacity: r4(params.intensity * fadeInOut(sec, durationSec, 0.3)),
  }
}

export const LightLeak: React.FC<OverlayProps<LightLeakParams>> = ({ params, time, video, seed }) => (
  <OverlayBox name="light_leak" video={video} style={lightLeakStyle(params, time.sec, time.durationSec, seed)} />
)
