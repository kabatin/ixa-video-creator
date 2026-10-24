'use client'

import type { PointerEvent as ReactPointerEvent } from 'react'
import { formatClock } from '@/lib/format-time'
import { playheadPct, secAtRatio } from '@/lib/waveform-playhead'

/**
 * 波形（`WaveformCanvas` の children）に重ねる再生位置の線。押した所へ飛ぶ。
 * 線の色は聴きながら切る（`cut-waveform-overlay.tsx`）と揃える。
 */
export const WaveformPlayhead = ({
  currentSec,
  durationSec,
  onSeek,
}: {
  readonly currentSec: number
  readonly durationSec: number
  readonly onSeek: (sec: number) => void
}) => {
  const pct = playheadPct(currentSec, durationSec)
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0) return
    onSeek(secAtRatio((event.clientX - bounds.left) / bounds.width, durationSec))
  }
  return (
    <div
      data-testid="waveform-playhead"
      className="absolute inset-0 cursor-pointer"
      title="押した所から聴く"
      onPointerDown={onPointerDown}
    >
      {pct !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 w-px -translate-x-1/2 bg-danger"
          style={{ left: `${String(pct)}%` }}
        />
      )}
      <p className="sr-only">{`再生位置 ${formatClock(currentSec)}`}</p>
    </div>
  )
}
