import type { SpeedLinesParams } from '@ixa/domain'
import type React from 'react'
import { fadeInOut } from './envelope.js'
import { OverlayBox, r4, type OverlayProps } from './overlay-box.js'
import { randomAt } from './random.js'

/** 線の数の幅。線の多さ 0 で最少、1 で最多。 */
const MIN_LINES = 24
const MAX_LINES = 120

/** 2 コマごとに線を引き直す。毎コマだと細かく震えて見え、止めると速さが出ない。 */
const RESHUFFLE_FRAMES = 2

export type SpeedLine = { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly width: number }

/**
 * スピード線の線（映像の矩形の座標）。`radial` は中心から外へ、`horizontal` は横に流れる。
 * 同じコマ・同じ値・同じ種なら同じ線になる。
 */
export const speedLines = (params: SpeedLinesParams, frame: number, width: number, height: number, seed: number): readonly SpeedLine[] => {
  const count = Math.round(MIN_LINES + (MAX_LINES - MIN_LINES) * params.density)
  const step = Math.floor(frame / RESHUFFLE_FRAMES)
  const unit = height / 1080
  const at = (i: number, k: number): number => randomAt(seed, (step * MAX_LINES + i) * 5 + k)
  return Array.from({ length: count }, (_, i): SpeedLine => {
    if (params.direction === 'horizontal') {
      const y = r4(height * at(i, 0))
      const length = width * (0.2 + 0.4 * at(i, 1))
      const x = width * (at(i, 2) * 1.4 - 0.2)
      return { x1: r4(x), y1: y, x2: r4(x + length), y2: y, width: r4(unit * (1 + 3 * at(i, 3))) }
    }
    const angle = at(i, 0) * Math.PI * 2
    const half = Math.hypot(width, height) / 2
    const inner = half * (0.35 + 0.25 * at(i, 1))
    const cx = width / 2
    const cy = height / 2
    return {
      x1: r4(cx + Math.cos(angle) * inner),
      y1: r4(cy + Math.sin(angle) * inner),
      x2: r4(cx + Math.cos(angle) * half * 1.2),
      y2: r4(cy + Math.sin(angle) * half * 1.2),
      width: r4(unit * (1.5 + 4 * at(i, 3))),
    }
  })
}

export const SpeedLines: React.FC<OverlayProps<SpeedLinesParams>> = ({ params, time, video, seed }) => {
  const lines = speedLines(params, time.frame, video.width, video.height, seed)
  const opacity = r4(params.intensity * fadeInOut(time.sec, time.durationSec, 0.15))
  return (
    <OverlayBox name="speed_lines" video={video} style={{ opacity }}>
      <svg width={video.width} height={video.height} viewBox={`0 0 ${String(video.width)} ${String(video.height)}`}>
        {lines.map((line, i) => (
          <line key={i} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="#ffffff" strokeWidth={line.width} strokeLinecap="round" />
        ))}
      </svg>
    </OverlayBox>
  )
}
