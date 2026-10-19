import type { Shot } from '../shot/shot.js'
import { shotPlaybackRate, takeSecToTimelineSec, usedSourceEndSec } from '../shot/timing.js'
import { SFX_DURATION_MAX_SEC, SFX_DURATION_MIN_SEC, type SfxCue } from '../sfx/sfx-job.js'
import type { MotionEvent, MotionEventKind, MotionOnset } from './motion-analysis.js'

/**
 * 動きの出来事をタイムラインに置き、効果音のきっかけにする（ADR-0054 §4）。**純粋。**
 */

/** タイムラインの秒に直した出来事。 */
export type TimelineMotionEvent = {
  readonly kind: MotionEventKind
  readonly startSec: number
  readonly durationSec: number
  readonly label: string
  readonly sfxPrompt: string
  readonly confidence: number
}

/** 長い続く音を分けたときに、隣と重ねる長さ（秒）。つなぎ目でぶつ切りにしない。 */
export const MOTION_SFX_SPLIT_OVERLAP_SEC = 0.25

/** 種類ごとの音量の既定。瞬間ははっきり、環境音は下に敷く。 */
const KIND_VOLUME: Readonly<Record<MotionEventKind, number>> = Object.freeze({
  moment: 0.8,
  sustained: 0.6,
  pass_by: 0.7,
  ambient: 0.4,
})

export type MotionSfxKind = `motion_${MotionEventKind}`

export type MotionSfxSuggestion = {
  readonly cue: SfxCue
  readonly kind: MotionSfxKind
  readonly reason: string
}

type PlacementShot = Pick<Shot, 'startSec' | 'timing' | 'durationSec' | 'sourceInSec'> & { readonly speed?: number }

/**
 * 出来事を Shot に映る範囲で切り、タイムラインの秒に直す。
 * 瞬間は始まりが映る範囲の外なら落とす。区間の音は映る範囲に切り詰め、重ならなければ落とす。
 */
export const motionEventsOnTimeline = (
  shot: PlacementShot,
  takeDurationSec: number | null,
  events: readonly MotionEvent[],
): readonly TimelineMotionEvent[] => {
  const visibleStart = shot.sourceInSec
  const visibleEnd = usedSourceEndSec(shot, takeDurationSec)
  const rate = shotPlaybackRate(shot, takeDurationSec)
  return events.flatMap((event) => {
    const fromSec = event.kind === 'moment' ? event.takeStartSec : Math.max(visibleStart, event.takeStartSec)
    const toSec = Math.min(visibleEnd, event.takeStartSec + event.takeDurationSec)
    const startSec = takeSecToTimelineSec(shot, fromSec, takeDurationSec)
    if (startSec === null || (event.kind !== 'moment' && toSec <= fromSec)) return []
    return [
      {
        kind: event.kind,
        startSec,
        durationSec: Math.max(0, toSec - fromSec) / rate,
        label: event.label,
        sfxPrompt: event.sfxPrompt,
        confidence: event.confidence,
      },
    ]
  })
}

/** タイムラインに直した動きの強さ。i 番目は startSec + i × hopSec 秒。 */
export type TimelineEnergyCurve = { readonly startSec: number; readonly hopSec: number; readonly values: readonly number[] }

/** 動きの強さのうち、Shot に映る範囲だけをタイムラインの秒に直す（画面の波）。 */
export const energyOnTimeline = (
  shot: PlacementShot,
  takeDurationSec: number | null,
  energy: readonly number[],
  hopSec: number,
): TimelineEnergyCurve => {
  const rate = shotPlaybackRate(shot, takeDurationSec)
  const visibleEnd = usedSourceEndSec(shot, takeDurationSec)
  const first = Math.ceil(shot.sourceInSec / hopSec - 1e-9)
  const values = energy.filter((_, i) => i >= first && i * hopSec < visibleEnd)
  return {
    startSec: shot.startSec + (first * hopSec - shot.sourceInSec) / rate,
    hopSec: hopSec / rate,
    values,
  }
}

/** 動きの山のうち、Shot に映るものだけをタイムラインの秒に直す。 */
export const onsetsOnTimeline = (
  shot: PlacementShot,
  takeDurationSec: number | null,
  onsets: readonly MotionOnset[],
): readonly MotionOnset[] =>
  onsets.flatMap((onset) => {
    const atSec = takeSecToTimelineSec(shot, onset.atSec, takeDurationSec)
    return atSec === null ? [] : [{ atSec, strength: onset.strength }]
  })

const round3 = (sec: number): number => Math.round(sec * 1000) / 1000

/** 10 秒を超える長さを、重ねながら同じ長さの切れに分ける。 */
const splitSpan = (startSec: number, durationSec: number): readonly { startSec: number; durationSec: number }[] => {
  if (durationSec <= SFX_DURATION_MAX_SEC) return [{ startSec, durationSec }]
  const step = SFX_DURATION_MAX_SEC - MOTION_SFX_SPLIT_OVERLAP_SEC
  const count = Math.ceil((durationSec - MOTION_SFX_SPLIT_OVERLAP_SEC) / step)
  const pieceSec = (durationSec + (count - 1) * MOTION_SFX_SPLIT_OVERLAP_SEC) / count
  return Array.from({ length: count }, (_, i) => ({
    startSec: startSec + i * (pieceSec - MOTION_SFX_SPLIT_OVERLAP_SEC),
    durationSec: pieceSec,
  }))
}

/**
 * 出来事を効果音のきっかけにする。続く音で 10 秒を超えるものは分けて並べ（sfx-api の上限）、
 * 0.5 秒未満は 0.5 秒にする。音の指示は出来事のものをそのまま使う。
 */
export const motionEventsToSfxCues = (events: readonly TimelineMotionEvent[]): readonly MotionSfxSuggestion[] =>
  events.flatMap((event) => {
    const pieces = splitSpan(event.startSec, event.durationSec)
    return pieces.map((piece, i) => ({
      kind: `motion_${event.kind}` as const,
      reason:
        pieces.length === 1
          ? `動き: ${event.label}`
          : `動き: ${event.label}（${String(i + 1)}/${String(pieces.length)}）`,
      cue: {
        startSec: round3(Math.max(0, piece.startSec)),
        durationSec: round3(Math.min(SFX_DURATION_MAX_SEC, Math.max(SFX_DURATION_MIN_SEC, piece.durationSec))),
        prompt: event.sfxPrompt,
        volume: KIND_VOLUME[event.kind],
      },
    }))
  })
