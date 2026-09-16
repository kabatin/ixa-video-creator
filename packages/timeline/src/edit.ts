import {
  shotEndSec,
  snapToBeat,
  type BeatSubdivision,
  type MusicSection,
  type Seconds,
  type Shot,
  type ShotId,
} from '@ixa/domain'
import { snapShotTiming } from '@ixa/music'
import { TIME_EPSILON, sortShotsByStart } from './ordering.js'

/**
 * タイムライン編集の純粋な操作。すべて新しい配列・オブジェクトを返し、入力を変更しない。
 * ビート計算は再実装せず `@ixa/domain` の `snapToBeat` と `@ixa/music` の `snapShotTiming` を使う。
 *
 * 返る配列はいずれも **`startSec` 昇順**に並ぶ。
 */

/** 新しい開始位置を持つ Shot。元の Shot は変更しない。 */
const withStart = (shot: Shot, startSec: Seconds): Shot =>
  shot.startSec === startSec ? shot : { ...shot, startSec }

/**
 * 重なりを解消するために後続を後ろへずらす。隙間はそのまま残す。
 * 先行 Shot は動かさない（移動した Shot の方が後ろへ寄る）。
 */
const rippleForward = (sorted: readonly Shot[]): Shot[] => {
  const result: Shot[] = []
  let cursor = 0
  for (const shot of sorted) {
    const startSec = Math.max(shot.startSec, cursor)
    const placed = withStart(shot, startSec)
    result.push(placed)
    cursor = shotEndSec(placed)
  }
  return result
}

/**
 * Shot を移動する。ビートにスナップし、他の Shot と重ならないよう後続をずらす。
 *
 * 移動先が先行 Shot と重なる場合は、その直後まで後ろへ寄せる（先行 Shot は動かさない）。
 * `shotId` が見つからない場合は並べ替えた複製を返す。
 */
export const moveShot = (
  shots: readonly Shot[],
  shotId: ShotId,
  newStartSec: Seconds,
  beats: readonly Seconds[],
  subdivision: BeatSubdivision,
): readonly Shot[] => {
  const target = shots.find((shot) => shot.id === shotId)
  if (target === undefined) return sortShotsByStart(shots)

  const snappedStart = Math.max(0, snapToBeat(newStartSec, beats, subdivision))
  const others = sortShotsByStart(shots.filter((shot) => shot.id !== shotId))
  const insertAt = others.filter((shot) => shot.startSec < snappedStart).length
  const sequence = [
    ...others.slice(0, insertAt),
    withStart(target, snappedStart),
    ...others.slice(insertAt),
  ]

  return rippleForward(sequence)
}

/**
 * Shot の尺を変える。後続 Shot を同じ量だけ前後にずらし、
 * 隙間も重なりも新たに作らない（リップル）。
 *
 * 新しい尺はビートグリッドへスナップされ、**0 以下にはならない**。
 * スナップしても正の尺にならない場合（ビートが無く 0 以下を指定した場合など）は
 * 元の尺を保ち、何も動かさない。
 */
export const trimShot = (
  shots: readonly Shot[],
  shotId: ShotId,
  newDurationSec: Seconds,
  beats: readonly Seconds[],
  subdivision: BeatSubdivision,
): readonly Shot[] => {
  const sorted = sortShotsByStart(shots)
  const index = sorted.findIndex((shot) => shot.id === shotId)
  const target = sorted[index]
  if (target === undefined) return sorted

  const snapped = snapShotTiming(target.startSec, newDurationSec, beats, subdivision)
  const durationSec = snapped.durationSec > 0 ? snapped.durationSec : target.durationSec
  const delta = durationSec - target.durationSec
  if (delta === 0) return sorted

  return sorted.map((shot, i) => {
    if (i < index) return shot
    if (i === index) return { ...shot, durationSec }
    return withStart(shot, Math.max(0, shot.startSec + delta))
  })
}

/** Shot 列を先頭から詰め直す（隙間を無くす）。尺は変えない。 */
export const compactShots = (shots: readonly Shot[]): readonly Shot[] => {
  const result: Shot[] = []
  let cursor = 0
  for (const shot of sortShotsByStart(shots)) {
    const placed = withStart(shot, cursor)
    result.push(placed)
    cursor = shotEndSec(placed)
  }
  return result
}

export type ProposedShot = {
  readonly startSec: Seconds
  readonly durationSec: Seconds
}

/**
 * 1 セクションを `targetShotDurationSec` に近い長さで等分し、内側の境界をビートへ寄せる。
 * セクションの開始・終了はそのまま使うので、**セクション境界をまたぐ Shot は作らない**。
 */
const splitSection = (
  section: MusicSection,
  beats: readonly Seconds[],
  targetShotDurationSec: number,
): ProposedShot[] => {
  const span = section.end - section.start
  if (!(span > TIME_EPSILON)) return []

  const count = Math.max(1, Math.round(span / targetShotDurationSec))
  const boundaries: Seconds[] = [section.start]

  for (let i = 1; i < count; i += 1) {
    const ideal = section.start + (span * i) / count
    const snapped = snapToBeat(ideal, beats, 1)
    const previous = boundaries[boundaries.length - 1] as number
    // グリッドがセクション外や既存の境界へ寄った場合は分割せずに繋げる。
    if (snapped > previous + TIME_EPSILON && snapped < section.end - TIME_EPSILON) {
      boundaries.push(snapped)
    }
  }
  boundaries.push(section.end)

  const shots: ProposedShot[] = []
  for (let i = 0; i + 1 < boundaries.length; i += 1) {
    const startSec = boundaries[i] as number
    const endSec = boundaries[i + 1] as number
    if (endSec - startSec > TIME_EPSILON) {
      shots.push({ startSec, durationSec: endSec - startSec })
    }
  }
  return shots
}

/**
 * 音楽のセクション境界から Shot の初期配置案を作る。
 *
 * 各セクションを `targetShotDurationSec` に近い長さで等分し、境界をビートにスナップする。
 * セクション境界をまたぐ Shot は作らない。入力は一切変更しない。
 *
 * @throws targetShotDurationSec が正の有限数でない場合。
 */
export const proposeShotsFromSections = (
  sections: readonly MusicSection[],
  beats: readonly Seconds[],
  targetShotDurationSec: number,
): readonly ProposedShot[] => {
  if (!Number.isFinite(targetShotDurationSec) || targetShotDurationSec <= 0) {
    throw new RangeError(
      `targetShotDurationSec は正の有限数である必要があります: ${String(targetShotDurationSec)}`,
    )
  }

  return [...sections]
    .sort((a, b) => a.start - b.start)
    .flatMap((section) => splitSection(section, beats, targetShotDurationSec))
}
