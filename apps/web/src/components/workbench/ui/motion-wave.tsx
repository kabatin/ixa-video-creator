'use client'

import { formatClock, formatDuration } from '@/lib/format-time'
import type { WireShotMotion } from '@/lib/motion-api'

/** 図の大きさ（SVG の座標。画面では幅いっぱいに伸ばす）。 */
const WIDTH = 1000
const HEIGHT = 72

const KIND_LABELS: Readonly<Record<WireShotMotion['events'][number]['kind'], string>> = {
  moment: '瞬間',
  sustained: '続く音',
  pass_by: '通り過ぎ',
  ambient: '環境音',
}

/**
 * Shot の動きの強さの波と、出来事の印（ADR-0054）。印を押すとそこから再生する。
 * 横軸は Shot の区間（タイムラインの秒）。
 */
export const MotionWave = ({
  range,
  motion,
  onSeek,
}: {
  readonly range: { readonly startSec: number; readonly durationSec: number }
  readonly motion: WireShotMotion
  readonly onSeek: (sec: number) => void
}) => {
  const x = (sec: number): number => ((sec - range.startSec) / range.durationSec) * WIDTH
  const values = motion.energy?.values ?? []
  const peak = Math.max(0.0001, ...values)
  const points = values
    .map((value, i) => {
      const sec = (motion.energy?.startSec ?? 0) + i * (motion.energy?.hopSec ?? 0)
      return `${x(sec).toFixed(1)},${(HEIGHT - (value / peak) * (HEIGHT - 8)).toFixed(1)}`
    })
    .join(' ')
  const bands = motion.events.filter((event) => event.kind !== 'moment')
  const moments = motion.events.filter((event) => event.kind === 'moment')

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        preserveAspectRatio="none"
        className="h-20 w-full rounded border border-line bg-surface-2"
        role="img"
        aria-label="動きの強さの波"
      >
        {bands.map((event, i) => (
          <rect
            key={`band-${String(i)}`}
            x={x(event.startSec)}
            y={0}
            width={Math.max(2, x(event.startSec + event.durationSec) - x(event.startSec))}
            height={HEIGHT}
            className="fill-accent/10"
          />
        ))}
        {motion.onsets.map((onset) => (
          <line
            key={`onset-${String(onset.atSec)}`}
            x1={x(onset.atSec)}
            x2={x(onset.atSec)}
            y1={HEIGHT - 6}
            y2={HEIGHT}
            className="stroke-muted"
            strokeWidth={2}
          />
        ))}
        {points !== '' && <polyline points={points} fill="none" className="stroke-text" strokeWidth={1.5} />}
        {moments.map((event, i) => (
          <line
            key={`moment-${String(i)}`}
            x1={x(event.startSec)}
            x2={x(event.startSec)}
            y1={0}
            y2={HEIGHT}
            className="stroke-accent"
            strokeWidth={2}
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-1" aria-label="出来事">
        {motion.events.map((event, i) => (
          <button
            key={`event-${String(i)}`}
            type="button"
            className="rounded border border-line bg-surface px-2 py-0.5 text-xs text-text hover:border-accent"
            title={`${KIND_LABELS[event.kind]}・${formatDuration(event.durationSec)}（ここから再生）`}
            onClick={() => {
              onSeek(event.startSec)
            }}
          >
            {`${formatClock(event.startSec)} ${event.label}`}
          </button>
        ))}
      </div>
    </div>
  )
}
