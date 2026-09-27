import type { Shot } from '@ixa/domain'
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  TAKE_SHORT_TOLERANCE_SEC,
  shotPlaybackRate,
  takeShortfallSec,
} from '@ixa/timeline'
import { formatDuration } from '@/lib/format-time'

/**
 * 「Take を尺に合わせる」の説明（ADR-0026）。
 * **倍率と不足の決め方は `@ixa/timeline` の 1 箇所**（プレビュー・書き出し・検査と同じ）。ここは言葉にするだけ。
 */
type TimingShot = Pick<Shot, 'timing' | 'durationSec' | 'sourceInSec'>

const rate = (value: number): string => `${value.toFixed(2)} 倍`

const WHAT_IT_DOES = `Take の長さに合わせて速度を変えます（${String(MIN_PLAYBACK_RATE)}〜${String(MAX_PLAYBACK_RATE)} 倍）。`

export const timingHint = (shot: TimingShot, takeDurationSec: number | null): string => {
  if (takeDurationSec === null) return WHAT_IT_DOES
  const shortfall = takeShortfallSec(shot, takeDurationSec)
  const short = shortfall > TAKE_SHORT_TOLERANCE_SEC

  if (shot.timing === 'fit') {
    const usable = Math.max(0, takeDurationSec - shot.sourceInSec)
    const head = `いまの速度 ${rate(shotPlaybackRate(shot, takeDurationSec))}（Take ${formatDuration(usable)} → 尺 ${formatDuration(shot.durationSec)}）。`
    return short
      ? `${head}${String(MIN_PLAYBACK_RATE)} 倍でも ${formatDuration(shortfall)} 足りず、最後のコマで止まります。`
      : head
  }

  if (!short) return WHAT_IT_DOES
  const fitted = shotPlaybackRate({ ...shot, timing: 'fit' }, takeDurationSec)
  return `Take が ${formatDuration(shortfall)} 足りず、最後のコマで止まります。合わせると ${rate(fitted)}になります。`
}
