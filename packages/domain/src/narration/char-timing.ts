import type { AppliedReading } from './reading.js'
import { charSpeechSeconds } from './speech-estimate.js'

/**
 * 字の時刻（ADR-0038）。テロップを話す速さに合わせて分ける・話している字を強調するのに使う。
 *
 * - ElevenLabs は**送った字（読み）**の 1 字ごとに時刻を返す → `displayTimesFromReading` で表示へ写し戻す
 * - 文字起こしは**聞き取った字**に時刻を付ける → `alignTimedText` で表示と突き合わせる
 *
 * 時刻は声（または録音の区間）の頭からの秒。
 */

export type CharTime = {
  readonly char: string
  readonly startSec: number
  readonly endSec: number
}

/** 読みの字の時刻を、表示の字の時刻にする。置き換えた言葉は、読みの区間を表示の字数で等分する。 */
export const displayTimesFromReading = (
  applied: AppliedReading,
  readingTimes: readonly CharTime[],
): readonly CharTime[] => {
  if (readingTimes.length !== [...applied.reading].length) {
    throw new Error(
      `字の時刻の数（${readingTimes.length}）が読みの字数（${[...applied.reading].length}）と合いません`,
    )
  }
  return applied.spans.flatMap((span) => {
    const display = [...applied.display].slice(span.display.start, span.display.end)
    const source = readingTimes.slice(span.reading.start, span.reading.end)
    if (!span.replaced) return display.map((char, index) => ({ ...timeAt(source, index), char }))
    const startSec = source[0]?.startSec ?? 0
    const endSec = source.at(-1)?.endSec ?? startSec
    return spread(display, startSec, endSec)
  })
}

const timeAt = (times: readonly CharTime[], index: number): CharTime =>
  times[index] ?? { char: '', startSec: 0, endSec: 0 }

/** 字を区間に字数で等分して並べる。 */
const spread = (chars: readonly string[], startSec: number, endSec: number): readonly CharTime[] => {
  const step = chars.length === 0 ? 0 : (endSec - startSec) / chars.length
  return chars.map((char, index) => ({ char, startSec: startSec + step * index, endSec: startSec + step * (index + 1) }))
}

/** 比べるための正規化（全角半角・カタカナとひらがな・大文字小文字の違いを無くす）。 */
const normalize = (char: string): string => {
  const folded = char.normalize('NFKC').toLowerCase()
  const code = folded.codePointAt(0) ?? 0
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : folded
}

/** 編集距離の表を作り、同じ字どうしの組（聞き取った字の番号 → 表示の字の番号）を返す。 */
const matchedPairs = (source: readonly string[], target: readonly string[]): ReadonlyMap<number, number> => {
  const rows = source.length + 1
  const cols = target.length + 1
  const cost: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const same = source[i - 1] === target[j - 1]
      cost[i]![j] = Math.min(cost[i - 1]![j - 1]! + (same ? 0 : 1), cost[i - 1]![j]! + 1, cost[i]![j - 1]! + 1)
    }
  }
  const pairs = new Map<number, number>()
  let i = source.length
  let j = target.length
  while (i > 0 && j > 0) {
    const same = source[i - 1] === target[j - 1]
    if (cost[i]![j] === cost[i - 1]![j - 1]! + (same ? 0 : 1)) {
      if (same) pairs.set(j - 1, i - 1)
      i -= 1
      j -= 1
    } else if (cost[i]![j] === cost[i - 1]![j]! + 1) {
      i -= 1
    } else {
      j -= 1
    }
  }
  return pairs
}

/**
 * 聞き取った字の時刻を、表示の字に付ける。同じ字（正規化して比べる）はその時刻を使い、
 * 合わない字（聞き違い・表示にしか無い句読点）は前後の合った字のあいだを字数で割り振る。
 * 1 字も合わなければ、聞き取った区間全体を等分する。
 */
export const alignTimedText = (source: readonly CharTime[], target: string): readonly CharTime[] => {
  const chars = [...target]
  const first = source[0]?.startSec ?? 0
  const last = source.at(-1)?.endSec ?? first
  const pairs = matchedPairs(source.map((t) => normalize(t.char)), chars.map(normalize))
  if (pairs.size === 0) return spread(chars, first, last)

  const result: CharTime[] = []
  let index = 0
  while (index < chars.length) {
    const sourceIndex = pairs.get(index)
    if (sourceIndex !== undefined) {
      const time = timeAt(source, sourceIndex)
      result.push({ char: chars[index] ?? '', startSec: time.startSec, endSec: time.endSec })
      index += 1
      continue
    }
    // 合わない字の並び。前の合った字の終わりから、次の合った字の始まりまでを割り振る。
    let end = index
    while (end < chars.length && !pairs.has(end)) end += 1
    const from = result.at(-1)?.endSec ?? first
    const nextSource = end < chars.length ? pairs.get(end) : undefined
    const until = nextSource === undefined ? last : timeAt(source, nextSource).startSec
    result.push(...spread(chars.slice(index, end), from, Math.max(from, until)))
    index = end
  }
  return result
}

/** 文字起こしの区間（文くらいの長さ）。 */
export type TimedSegment = {
  readonly text: string
  readonly startSec: number
  readonly endSec: number
}

/**
 * 区間の時刻しか返さない文字起こし（whisper.cpp など）の結果を、字の時刻にする。
 * 区間の中は話す長さの重み（拍・句読点の間）で割り振る。重みが無ければ字数で等分する。
 */
export const charTimesFromSegments = (segments: readonly TimedSegment[]): readonly CharTime[] =>
  segments.flatMap((segment) => {
    const chars = [...segment.text]
    const weights = chars.map(charSpeechSeconds)
    const total = weights.reduce((sum, w) => sum + w, 0)
    if (total <= 0) return spread(chars, segment.startSec, segment.endSec)
    const length = segment.endSec - segment.startSec
    let at = segment.startSec
    return chars.map((char, index) => {
      const startSec = at
      at += (length * (weights[index] ?? 0)) / total
      return { char, startSec, endSec: at }
    })
  })
