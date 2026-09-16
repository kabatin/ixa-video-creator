import { expandBeatGrid, snapToBeat, type BeatSubdivision, type Seconds } from '@ixa/domain'

/**
 * ビートグリッド上の計算。**純粋関数のみ。** IO も乱数も時計も使わない。
 * Shot 割りとタイムラインのスナップはすべてここを通る。
 */

/** 4/4 拍子。既定の拍子。 */
export const DEFAULT_BEATS_PER_BAR = 4

/**
 * 最も近いダウンビート（小節頭）を返す。
 * ダウンビートが空の場合は入力をそのまま返す（グリッドが無いので寄せ先が無い）。
 * 等距離のときは早い方を返す。
 */
export const nearestDownbeat = (timeSec: number, downbeats: readonly number[]): number => {
  const first = downbeats[0]
  if (first === undefined) return timeSec

  let best = first
  let bestDistance = Math.abs(timeSec - first)
  for (const candidate of downbeats) {
    const distance = Math.abs(timeSec - candidate)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/**
 * `[startSec, endSec)` に含まれるビートの数。**end は排他**（`TimeRange` と同じ規約）。
 * 範囲が逆転している、または空の場合は 0。
 */
export const beatsBetween = (
  startSec: number,
  endSec: number,
  beats: readonly number[],
): number => {
  if (!(endSec > startSec)) return 0
  let count = 0
  for (const beat of beats) {
    if (beat >= startSec && beat < endSec) count += 1
  }
  return count
}

/**
 * 1 小節の長さ（秒）。
 *
 * @throws bpm が正の有限数でない、または beatsPerBar が 1 以上の整数でない場合。
 */
export const barDurationSec = (bpm: number, beatsPerBar: number = DEFAULT_BEATS_PER_BAR): number => {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new RangeError(`bpm は正の有限数である必要があります: ${String(bpm)}`)
  }
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1) {
    throw new RangeError(`beatsPerBar は 1 以上の整数である必要があります: ${String(beatsPerBar)}`)
  }
  return (60 / bpm) * beatsPerBar
}

/**
 * 尺を小節数へ量子化する。最も近い小節数を返し、**下限は 1 小節**。
 * 尺 0 の Shot を作らないための保証。
 *
 * @throws durationSec が有限でない、または bpm / beatsPerBar が不正な場合。
 */
export const quantizeToBarCount = (
  durationSec: number,
  bpm: number,
  beatsPerBar: number = DEFAULT_BEATS_PER_BAR,
): number => {
  if (!Number.isFinite(durationSec)) {
    throw new RangeError(`durationSec は有限数である必要があります: ${String(durationSec)}`)
  }
  const bar = barDurationSec(bpm, beatsPerBar)
  return Math.max(1, Math.round(durationSec / bar))
}

/**
 * Shot の開始と尺をビートグリッドへ合わせる。**Shot 割りの中核。**
 *
 * 開始と終了をそれぞれグリッドへ寄せ、結果として尺が 0 以下になった場合は
 * **最小 1 グリッド分**の尺を与える。尺 0 の Shot はタイムラインに乗らないため。
 *
 * ビートが空の場合はグリッドが無いので入力をそのまま返す。
 */
export const snapShotTiming = (
  startSec: number,
  durationSec: number,
  beats: readonly Seconds[],
  subdivision: BeatSubdivision,
): { startSec: Seconds; durationSec: Seconds } => {
  if (beats.length === 0) return { startSec, durationSec }

  const grid = expandBeatGrid(beats, subdivision)
  const snappedStart = snapToBeat(startSec, beats, subdivision)
  const snappedEnd = snapToBeat(startSec + durationSec, beats, subdivision)

  if (snappedEnd > snappedStart) {
    return { startSec: snappedStart, durationSec: snappedEnd - snappedStart }
  }

  return { startSec: snappedStart, durationSec: minimumStep(grid, snappedStart) }
}

/**
 * `from` の次のグリッド点までの距離。
 * `from` がグリッドの末尾で次が無い場合は、グリッドの代表的な刻み幅で代用する。
 */
const minimumStep = (grid: readonly number[], from: number): number => {
  for (const point of grid) {
    if (point > from) return point - from
  }
  return fallbackStep(grid)
}

/** グリッドの刻み幅。等間隔でない場合に備えて最小の正の間隔を採る。 */
const fallbackStep = (grid: readonly number[]): number => {
  let smallest = Number.POSITIVE_INFINITY
  for (let i = 0; i + 1 < grid.length; i += 1) {
    const previous = grid[i]
    const next = grid[i + 1]
    if (previous === undefined || next === undefined) continue
    const step = next - previous
    if (step > 0 && step < smallest) smallest = step
  }
  return Number.isFinite(smallest) ? smallest : 0
}
