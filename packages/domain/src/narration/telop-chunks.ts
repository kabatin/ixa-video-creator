import { MIN_TEXT_CLIP_DURATION_SEC } from '../timeline/text-template.js'
import type { CharTime } from './char-timing.js'
import type { TextRange } from './reading.js'

/**
 * ナレーションの 1 行を、テロップ何枚かに分けて時刻を付ける（ADR-0038）。
 *
 * - 分けるのは句点（。！？）。長い文は読点（、）で分け、上限の字数までまとめる。それでも長ければ上限で切る
 * - 時刻は字の時刻があれば「次の枚の最初の字が話されるとき」に切り替える。無ければ読みの拍で按分する
 * - 読めないほど短い枚（テロップの最短未満）は隣とまとめる
 */

/** 1 枚の字数の上限。字幕の目安（1 行 16 字 × 2 行）。 */
export const NARRATION_TELOP_MAX_CHARS = 32

const SENTENCE_END = /[。．！？!?]/u
const CLOSING = /[」』）)】〕"'”’]/u
const CLAUSE_END = /[、,，\s]/u

export type TelopChunk = {
  readonly text: string
  /** 表示の字（コードポイント）の位置。 */
  readonly range: TextRange
}

/** 字の並びを、区切りの字の直後で切る。閉じかっこは前に付ける。 */
const cutAfter = (chars: readonly string[], from: number, to: number, isEnd: (char: string) => boolean): readonly TextRange[] => {
  const ranges: TextRange[] = []
  let start = from
  let index = from
  while (index < to) {
    const char = chars[index] ?? ''
    index += 1
    if (!isEnd(char)) continue
    while (index < to && (CLOSING.test(chars[index] ?? '') || SENTENCE_END.test(chars[index] ?? ''))) index += 1
    ranges.push({ start, end: index })
    start = index
  }
  if (start < to) ranges.push({ start, end: to })
  return ranges
}

/** 上限を超えない限り、隣り合う区間をまとめる。1 つで上限を超える区間は上限の字数で切る。 */
const packWithin = (ranges: readonly TextRange[], maxChars: number): readonly TextRange[] =>
  ranges
    .flatMap((range) =>
      range.end - range.start <= maxChars
        ? [range]
        : Array.from({ length: Math.ceil((range.end - range.start) / maxChars) }, (_, i) => ({
            start: range.start + i * maxChars,
            end: Math.min(range.end, range.start + (i + 1) * maxChars),
          })),
    )
    .reduce<readonly TextRange[]>((packed, range) => {
      const last = packed.at(-1)
      return last !== undefined && range.end - last.start <= maxChars
        ? [...packed.slice(0, -1), { start: last.start, end: range.end }]
        : [...packed, range]
    }, [])

/** 区間の前後の空白を落とす。空白だけなら null。 */
const trimRange = (chars: readonly string[], range: TextRange): TelopChunk | null => {
  let start = range.start
  let end = range.end
  while (start < end && /\s/u.test(chars[start] ?? '')) start += 1
  while (end > start && /\s/u.test(chars[end - 1] ?? '')) end -= 1
  return start === end ? null : { text: chars.slice(start, end).join(''), range: { start, end } }
}

/** 表示を、テロップの枚に分ける。 */
export const splitTelopText = (display: string, maxChars: number = NARRATION_TELOP_MAX_CHARS): readonly TelopChunk[] => {
  const chars = [...display]
  return cutAfter(chars, 0, chars.length, (char) => SENTENCE_END.test(char))
    .flatMap((sentence) =>
      sentence.end - sentence.start <= maxChars
        ? [sentence]
        : packWithin(cutAfter(chars, sentence.start, sentence.end, (char) => CLAUSE_END.test(char)), maxChars),
    )
    .flatMap((range) => {
      const chunk = trimRange(chars, range)
      return chunk === null ? [] : [chunk]
    })
}

export type TimedTelopChunk = {
  readonly text: string
  /** 行（声）の頭からの秒。 */
  readonly startSec: number
  readonly durationSec: number
  /** 字の時刻（この枚の頭からの秒）。字の時刻が無い声では null。 */
  readonly chars: readonly CharTime[] | null
}

export type TimeTelopChunksInput = {
  readonly display: string
  readonly chunks: readonly TelopChunk[]
  /** 声の長さ。最後の枚はここまで出す。 */
  readonly durationSec: number
  /** 表示の字ごとの時刻。無ければ `weights` で按分する。 */
  readonly displayTimes: readonly CharTime[] | null
  /** 表示の字ごとの話す長さの重み（`displaySpeechWeights`）。 */
  readonly weights: readonly number[]
}

const roundMs = (seconds: number): number => Math.round(seconds * 1000) / 1000

/** 各枚の始まりの秒（最初は 0）。 */
const startsOf = (input: TimeTelopChunksInput): readonly number[] => {
  const { chunks, durationSec, displayTimes, weights } = input
  if (displayTimes !== null) return chunks.map((chunk, i) => (i === 0 ? 0 : displayTimes[chunk.range.start]?.startSec ?? 0))
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) return chunks.map((_, i) => (durationSec * i) / chunks.length)
  return chunks.map((chunk, i) =>
    i === 0 ? 0 : (durationSec * weights.slice(0, chunk.range.start).reduce((sum, w) => sum + w, 0)) / total,
  )
}

type Span = { readonly range: TextRange; readonly startSec: number; readonly endSec: number }

/** 短すぎる枚を隣とまとめる（次があれば次と、最後なら前と）。 */
const mergeShort = (spans: readonly Span[]): readonly Span[] => {
  const index = spans.findIndex((span) => span.endSec - span.startSec < MIN_TEXT_CLIP_DURATION_SEC)
  if (index === -1 || spans.length < 2) return spans
  const [a, b] = index < spans.length - 1 ? [index, index + 1] : [index - 1, index]
  const first = spans[a]
  const second = spans[b]
  if (first === undefined || second === undefined) return spans
  const merged = { range: { start: first.range.start, end: second.range.end }, startSec: first.startSec, endSec: second.endSec }
  return mergeShort([...spans.slice(0, a), merged, ...spans.slice(b + 1)])
}

/** 枚ごとに時刻を付ける。 */
export const timeTelopChunks = (input: TimeTelopChunksInput): readonly TimedTelopChunk[] => {
  const { chunks, durationSec, displayTimes } = input
  const chars = [...input.display]
  const starts = startsOf(input).map((start) => roundMs(Math.min(Math.max(start, 0), durationSec)))
  const spans = mergeShort(
    chunks.map((chunk, i) => ({ range: chunk.range, startSec: starts[i] ?? 0, endSec: starts[i + 1] ?? roundMs(durationSec) })),
  )
  return spans.map((span) => ({
    text: chars.slice(span.range.start, span.range.end).join(''),
    startSec: span.startSec,
    durationSec: roundMs(span.endSec - span.startSec),
    chars:
      displayTimes === null
        ? null
        : displayTimes.slice(span.range.start, span.range.end).map((time) => ({
            char: time.char,
            startSec: time.startSec - span.startSec,
            endSec: time.endSec - span.startSec,
          })),
  }))
}
