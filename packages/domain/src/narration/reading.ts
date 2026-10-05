import { z } from 'zod'

/**
 * 読み辞書（ADR-0038）。テロップには「表示」を、声の AI には「読み」を渡す。
 * 読み間違えやすい言葉（戦子 → せんこ）を作品ごとに登録し、読みを作るときに置き換える。
 *
 * 置き換えた区間を表示と読みの両方で残す。語の時刻は読みに付くので、表示（テロップ）へ写し戻すときに使う。
 */

export const MAX_READING_ENTRIES = 500

export const ReadingEntry = z.object({
  /** 表示での書き方（例: 戦子）。 */
  written: z.string().trim().min(1).max(40),
  /** 読ませ方（例: せんこ）。 */
  reading: z.string().trim().min(1).max(80),
})
export type ReadingEntry = z.infer<typeof ReadingEntry>

export const ReadingDictionary = z.array(ReadingEntry).max(MAX_READING_ENTRIES)
export type ReadingDictionary = z.infer<typeof ReadingDictionary>

/** 辞書の問題。無ければ null。同じ言葉に読みが 2 つあると、どちらを使うか決まらない。 */
export const readingDictionaryProblem = (dictionary: readonly ReadingEntry[]): string | null => {
  const seen = new Set<string>()
  for (const entry of dictionary) {
    if (seen.has(entry.written)) return `「${entry.written}」の読みが 2 つあります。1 つにしてください`
    seen.add(entry.written)
  }
  return null
}

/** 字（コードポイント）の位置の区間。`end` は含まない。 */
export type TextRange = { readonly start: number; readonly end: number }

/** 表示の一区間と、それに当たる読みの一区間。置き換えなかった所は同じ字が 1 対 1 で並ぶ。 */
export type ReadingSpan = {
  readonly display: TextRange
  readonly reading: TextRange
  readonly replaced: boolean
}

export type AppliedReading = {
  /** 元の表示（テロップに出す字）。 */
  readonly display: string
  readonly reading: string
  readonly spans: readonly ReadingSpan[]
}

/** その位置から当たる言葉のうち、いちばん長いもの。字（コードポイント）の並びで比べる。 */
const longestMatchAt = (chars: readonly string[], index: number, entries: readonly ReadingEntry[]): ReadingEntry | null =>
  entries.reduce<ReadingEntry | null>((best, entry) => {
    const written = [...entry.written]
    const hit = written.every((char, offset) => chars[index + offset] === char)
    return hit && (best === null || written.length > [...best.written].length) ? entry : best
  }, null)

type Piece = { readonly display: string; readonly reading: string; readonly replaced: boolean }

/** 表示を、置き換えない字の並びと、置き換える言葉に切り分ける（前から、長い言葉を優先）。 */
const piecesOf = (text: string, dictionary: readonly ReadingEntry[]): readonly Piece[] => {
  const chars = [...text]
  const pieces: Piece[] = []
  let plain = ''
  let index = 0
  while (index < chars.length) {
    const match = longestMatchAt(chars, index, dictionary)
    if (match === null) {
      plain += chars[index] ?? ''
      index += 1
      continue
    }
    if (plain !== '') pieces.push({ display: plain, reading: plain, replaced: false })
    plain = ''
    pieces.push({ display: match.written, reading: match.reading, replaced: true })
    index += [...match.written].length
  }
  if (plain !== '') pieces.push({ display: plain, reading: plain, replaced: false })
  return pieces
}

/** 表示から読みを作る。辞書の言葉を読みに置き換え、区間の対応を返す。 */
export const applyReadings = (text: string, dictionary: readonly ReadingEntry[]): AppliedReading => {
  const pieces = piecesOf(text, dictionary)
  const spans = pieces.reduce<{ readonly at: TextRange; readonly spans: readonly ReadingSpan[] }>(
    (acc, piece) => {
      const display = { start: acc.at.start, end: acc.at.start + [...piece.display].length }
      const reading = { start: acc.at.end, end: acc.at.end + [...piece.reading].length }
      return { at: { start: display.end, end: reading.end }, spans: [...acc.spans, { display, reading, replaced: piece.replaced }] }
    },
    { at: { start: 0, end: 0 }, spans: [] },
  ).spans
  return { display: text, reading: pieces.map((piece) => piece.reading).join(''), spans }
}
