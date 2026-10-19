import { musicPlayedDurationSec, type MusicTrack } from '@ixa/domain'
import { formatClock } from '@/lib/format-time'
import type { ViewRange } from '@/lib/waveform-draw'

/**
 * 曲の終わりの赤線（制作者 2026-10-19「曲の終わりが赤線で見えればよい」）。**React を含まない。**
 *
 * 波形は音源の時間で描く。線の位置は「開始位置から数えて何秒鳴るか」（domain の `musicPlayedDurationSec`）。
 * 題はタイムラインの時刻（インスペクターの「曲の終わり」と同じ値）で言う。
 */

export type MusicEndMark = {
  /** 波形の上の位置（音源の秒）。 */
  readonly atSec: number
  readonly title: string
}

/** 終わりを決めていない・音源より後を指している（自然に終わる）なら null。 */
export const musicEndMark = (
  track: Pick<MusicTrack, 'offsetSec' | 'endSec'>,
  sourceDurationSec: number,
): MusicEndMark | null => {
  if (track.endSec === null || track.endSec === undefined) return null
  const atSec = musicPlayedDurationSec(track, sourceDurationSec)
  if (atSec >= sourceDurationSec) return null
  return { atSec, title: `曲の終わり ${formatClock(track.endSec)}` }
}

/**
 * 表示範囲の左から何 % の所に線を引くか。範囲より前なら 0（映っている全部が終わりの後）、
 * 範囲より後ろなら null（線も薄い所も映っていない）。
 */
export const musicEndOverlayPct = (atSec: number, view: ViewRange): number | null => {
  const span = view.endSec - view.startSec
  if (span <= 0 || atSec > view.endSec) return null
  return Math.max(0, ((atSec - view.startSec) / span) * 100)
}
