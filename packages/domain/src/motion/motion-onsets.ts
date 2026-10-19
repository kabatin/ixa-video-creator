import type { MotionEvent, MotionOnset } from './motion-analysis.js'

/**
 * 動きの強さの列から、山と続く区間を取り出す（ADR-0054 §2）。**純粋。**
 *
 * 強さの列は「隣のコマとの差の平均（0〜1）」。i 番目は i × hopSec 秒。
 * 宣伝動画 TT-07（跳ねる足音）の試算で決めた値を既定にする。
 */

/** 山の基準にする前後の幅（秒）。この幅の中央値を引いた「急に増えた分」で山を見る。 */
export const MOTION_ONSET_BASELINE_SEC = 0.5
/** 最も強い山に対する比。これに満たない山は捨てる。 */
export const MOTION_ONSET_RELATIVE_MIN = 0.2
/** 急に増えた分の下限。これより小さい山はノイズ（圧縮のちらつき）として捨てる。 */
export const MOTION_ONSET_ABSOLUTE_MIN = 0.003
/** これより近い 2 つの山は 1 つにする（強い方を残す）。 */
export const MOTION_ONSET_MIN_GAP_SEC = 0.15
/** AI の瞬間の時刻を寄せる幅（秒）。AI はコマの粗い帯しか見ていないので時刻が甘い。 */
export const MOTION_SNAP_WINDOW_SEC = 0.25

/** 続く区間: 最も強いコマに対する比と、強さの下限と、短すぎる区間を捨てる長さ。 */
export const MOTION_SUSTAINED_RELATIVE_MIN = 0.5
export const MOTION_SUSTAINED_ABSOLUTE_MIN = 0.015
export const MOTION_SUSTAINED_MIN_SEC = 0.5

/** 山だけから作る瞬間の案（AI で見ていないとき）。 */
const FALLBACK_MOMENT_LABEL = '動きの山'
const FALLBACK_MOMENT_PROMPT = 'short soft impact thud'
const FALLBACK_MOMENT_DURATION_SEC = 0.5

const assertHop = (hopSec: number): void => {
  if (!Number.isFinite(hopSec) || hopSec <= 0) {
    throw new Error(`動きの強さのコマの間隔が正の秒ではありません: ${String(hopSec)}`)
  }
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/**
 * 前後の中央値を引いた「急に増えた分」。先頭は前のコマが無い（差を取れない）ので基準から外す。
 * カメラが動き続ける Shot では強さ全体が底上げされるので、絶対値ではなくこれで山を見る。
 */
const novelty = (energy: readonly number[], hopSec: number): readonly number[] => {
  const radius = Math.max(1, Math.round(MOTION_ONSET_BASELINE_SEC / hopSec))
  return energy.map((value, i) => {
    const window = energy.slice(Math.max(1, i - radius), Math.min(energy.length, i + radius + 1))
    return Math.max(0, value - median(window))
  })
}

type Peak = { readonly index: number; readonly value: number }

const localPeaks = (values: readonly number[], threshold: number): readonly Peak[] =>
  values.flatMap((value, i) => {
    const before = values[i - 1]
    const after = values[i + 1]
    if (before === undefined || after === undefined) return []
    return value >= threshold && value > before && value >= after ? [{ index: i, value }] : []
  })

/** 近すぎる山をまとめる（強い方を残す）。 */
const mergeClosePeaks = (peaks: readonly Peak[], hopSec: number): readonly Peak[] =>
  peaks.reduce<readonly Peak[]>((kept, peak) => {
    const last = kept[kept.length - 1]
    if (last === undefined || (peak.index - last.index) * hopSec >= MOTION_ONSET_MIN_GAP_SEC) return [...kept, peak]
    return peak.value > last.value ? [...kept.slice(0, -1), peak] : kept
  }, [])

/** 動きの強さの山を、時刻と相対の強さ（最も強い山 = 1）で返す。 */
export const detectOnsets = (energy: readonly number[], hopSec: number): readonly MotionOnset[] => {
  assertHop(hopSec)
  if (energy.length < 3) return []
  const values = novelty(energy, hopSec)
  const max = Math.max(...values)
  if (max < MOTION_ONSET_ABSOLUTE_MIN) return []
  const threshold = Math.max(MOTION_ONSET_ABSOLUTE_MIN, MOTION_ONSET_RELATIVE_MIN * max)
  return mergeClosePeaks(localPeaks(values, threshold), hopSec).map((peak) => ({
    atSec: peak.index * hopSec,
    strength: peak.value / max,
  }))
}

export type MotionSegment = { readonly startSec: number; readonly endSec: number }

/** 強さが閾値を超え続ける区間（続く音の目安）。短すぎる区間は捨てる。 */
export const sustainedSegments = (energy: readonly number[], hopSec: number): readonly MotionSegment[] => {
  assertHop(hopSec)
  if (energy.length === 0) return []
  const threshold = Math.max(MOTION_SUSTAINED_ABSOLUTE_MIN, MOTION_SUSTAINED_RELATIVE_MIN * Math.max(...energy))
  const runs = energy.reduce<{ readonly done: readonly MotionSegment[]; readonly openAt: number | null }>(
    (acc, value, i) => {
      if (value >= threshold) return acc.openAt === null ? { ...acc, openAt: i } : acc
      return acc.openAt === null
        ? acc
        : { done: [...acc.done, { startSec: acc.openAt * hopSec, endSec: i * hopSec }], openAt: null }
    },
    { done: [], openAt: null },
  )
  const all =
    runs.openAt === null
      ? runs.done
      : [...runs.done, { startSec: runs.openAt * hopSec, endSec: energy.length * hopSec }]
  return all.filter((segment) => segment.endSec - segment.startSec >= MOTION_SUSTAINED_MIN_SEC)
}

const nearestOnset = (atSec: number, onsets: readonly MotionOnset[], windowSec: number): MotionOnset | null =>
  onsets.reduce<MotionOnset | null>((best, onset) => {
    const distance = Math.abs(onset.atSec - atSec)
    if (distance > windowSec) return best
    return best === null || distance < Math.abs(best.atSec - atSec) ? onset : best
  }, null)

/**
 * AI の瞬間の時刻を、近くの山に寄せる。**瞬間だけ**（続く音などは区間なので寄せない）。
 * 2 つの瞬間が同じ山に寄ったら、確からしい方だけを残す（同じコマで 2 つ鳴らさない）。時刻順に返す。
 */
export const snapToOnsets = (
  events: readonly MotionEvent[],
  onsets: readonly MotionOnset[],
  windowSec: number = MOTION_SNAP_WINDOW_SEC,
): readonly MotionEvent[] => {
  const snapped = events.map((event) => {
    if (event.kind !== 'moment') return event
    const onset = nearestOnset(event.takeStartSec, onsets, windowSec)
    return onset === null ? event : { ...event, takeStartSec: onset.atSec }
  })
  const deduped = snapped.filter(
    (event, i) =>
      event.kind !== 'moment' ||
      !snapped.some(
        (other, j) =>
          j !== i &&
          other.kind === 'moment' &&
          other.takeStartSec === event.takeStartSec &&
          (other.confidence > event.confidence || (other.confidence === event.confidence && j < i)),
      ),
  )
  return [...deduped].sort((a, b) => a.takeStartSec - b.takeStartSec)
}

/** AI で見ていないときの案: 山をそのまま「瞬間」にする（確からしさ = 山の強さ）。 */
export const onsetsToMomentEvents = (onsets: readonly MotionOnset[]): readonly MotionEvent[] =>
  onsets.map((onset) => ({
    kind: 'moment',
    takeStartSec: onset.atSec,
    takeDurationSec: FALLBACK_MOMENT_DURATION_SEC,
    label: FALLBACK_MOMENT_LABEL,
    sfxPrompt: FALLBACK_MOMENT_PROMPT,
    confidence: onset.strength,
  }))
