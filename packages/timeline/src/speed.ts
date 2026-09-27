import type { Shot } from '@ixa/domain'

/**
 * 尺に合わせた速度（ADR-0026）。
 *
 * `fit` の Shot は、採用 Take の切り出し位置（`sourceInSec`）から後ろ全体を Shot の尺に収める。
 * 幅は元の MV（手作業の Remotion）と同じ 0.5〜2.5 倍。これより遅いと滲み、速いと落ち着かない。
 * **プレビューと書き出しは同じ文書を読む**ので、ここで決めた値が両方に効く。
 */
export const MIN_PLAYBACK_RATE = 0.5
export const MAX_PLAYBACK_RATE = 2.5

/** これより短い不足は数えない（フレームの端数・probe の丸め）。検査と画面が同じ値を使う。 */
export const TAKE_SHORT_TOLERANCE_SEC = 0.05

type TimingShot = Pick<Shot, 'timing' | 'durationSec' | 'sourceInSec'>

/** Take の使える長さ（切り出し位置より後ろ）。分からなければ null。 */
const usableSec = (shot: TimingShot, takeDurationSec: number | null): number | null =>
  takeDurationSec === null || takeDurationSec <= shot.sourceInSec
    ? null
    : takeDurationSec - shot.sourceInSec

/** その Shot の再生速度。`trim` と、Take の長さが分からないときは 1。 */
export const shotPlaybackRate = (shot: TimingShot, takeDurationSec: number | null): number => {
  if (shot.timing !== 'fit') return 1
  const usable = usableSec(shot, takeDurationSec)
  if (usable === null) return 1
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, usable / shot.durationSec))
}

/**
 * 速度を考えても Take が足りない秒数。**最後のコマで止まる長さ**。
 * 長さが分からなければ 0（分からないことを「足りない」と言わない）。
 */
export const takeShortfallSec = (shot: TimingShot, takeDurationSec: number | null): number => {
  const usable = usableSec(shot, takeDurationSec)
  if (usable === null) return 0
  const covered = usable / shotPlaybackRate(shot, takeDurationSec)
  return Math.max(0, shot.durationSec - covered)
}
