import { voicedLevelDb } from '@ixa/domain'
import { LEVEL_FRAME, rmsFramesFromPcm, slicePcm } from './rms-frames.js'

/**
 * 声の大きさを合わせる（ADR-0062）。声のある所の RMS を元の H3 の声と同じにしてから、距離の dB を足す。
 * 響き・EQ は掛けない（AnimalVideo で、部屋では響かず不自然だった）。
 */

/** 掛ける dB の上限（`voice-audio.ts` と同じ ±20 dB。ほぼ無音の読み上げを持ち上げすぎない）。 */
export const MAX_MATCH_GAIN_DB = 20

/** 声のある所の大きさ（dBFS）。区間を渡せばその中だけ。声が無ければ null。 */
export const voicedLevelOfPcm = (samples: Int16Array, range?: { readonly startSec: number; readonly endSec: number }): number | null =>
  voicedLevelDb(rmsFramesFromPcm(range === undefined ? samples : slicePcm(samples, range.startSec, range.endSec), LEVEL_FRAME))

/**
 * 読み上げに掛ける dB。元の声と同じ大きさ + 距離（`levelDb`）。どちらかの大きさが測れなければ、距離だけを掛ける。
 */
export const matchLevelGainDb = (input: {
  readonly sourceLevelDb: number | null
  readonly voiceLevelDb: number | null
  readonly levelDb: number
}): number => {
  const gain =
    input.sourceLevelDb === null || input.voiceLevelDb === null ? input.levelDb : input.sourceLevelDb - input.voiceLevelDb + input.levelDb
  return Math.max(-MAX_MATCH_GAIN_DB, Math.min(MAX_MATCH_GAIN_DB, gain))
}
