import { ASSIGN_AMBIGUITY_MARGIN, assignByLength, type LengthLine } from './assign-by-length.js'
import { assignByText, type TranscriptWord } from './assign-by-text.js'
import { DUB_MAX_TEMPO } from './chunk-tempo.js'
import type { DialogueDub } from './dialogue-dub.js'
import type { DubWarning } from './dub-record.js'
import { mergeChunksTo, spanOf, type ChunkGroup } from './pair-chunks.js'
import type { DubChunk } from './speech-chunks.js'

/**
 * 行の区間（ADR-0062）。H3 が話した元の声の区間を、セリフの行に割り当てる。
 *
 * - 足す行（`added`）は数えない（H3 は話していない）
 * - 行の手の区間（`startSec`/`endSec`）があればそれを使う。その区間に掛かる声の区間は他の行に回さない
 * - 文字起こしの語（`transcript`）があれば、まずそれで残りの行に声の区間を割り当てる（`assignByText`）。
 *   決められない並び（語が行と合わない・語が足りない）と、文字起こしが使えなかった（null）並びは、
 *   下の読み上げの長さで割り当て、その行に `line_span_by_length` の警告を付ける（黙って長さに頼らない）
 * - 読み上げの長さ（`ttsSec`）があれば、残りの行に続いた区間の並びを、読み上げの長さに合うように割り当てる
 *   （`assignByLength`。クリック・環境音の区間は飛ばす）。どの割り当てでも 1.6 倍を超えるなら止める（0.8 倍未満は止めない）。
 *   次に良い割り当てとほとんど差が無ければ、良い方を使い、その行に迷いの警告を付ける
 * - 読み上げの長さが無い並びは、残りの声の区間を、すき間の短い所からつないで行の数にそろえて順に割り当てる
 * - 区間が行より少なければ、理由を付けて止める（手の区間を入れてもらう）
 *
 * 2 人のセリフが続けて 1 つの区間になると、つなぐだけでは分けられない（分かっている不足）。
 */

export type LineSpan = {
  readonly lineIndex: number
  readonly startSec: number
  readonly endSec: number
  readonly source: 'chunks' | 'manual'
  /** 行の区間に入る元の声の区間（口に合わせる組を作るのに使う）。 */
  readonly chunks: readonly DubChunk[]
}

/** 行の手の区間の案（ADR-0062 段 5b）。まとまった声の区間を、行の文字数の比で割ったもの。画面が各行に先に入れておく。 */
export type LineSpanSuggestion = { readonly lineIndex: number; readonly startSec: number; readonly endSec: number }

/** 行の区間に付ける警告（記録の行の警告に入れる）。 */
export type LineSpanWarning = { readonly lineIndex: number; readonly warning: DubWarning }

/** 行ごとの読み上げの声の長さ（読み方ごと、秒）。鍵は行の番号。 */
export type LineTtsLengths = ReadonlyMap<number, readonly number[]>

export type AssignResult =
  | { readonly ok: true; readonly spans: readonly LineSpan[]; readonly warnings: readonly LineSpanWarning[] }
  | {
      readonly ok: false
      /** `shortage` は区間が行より少ない、`no_fit` は読み上げの長さに合う割り当てが無い（読み方を増やせば収まることがある）。 */
      readonly cause: 'shortage' | 'no_fit'
      /** 理由で名指しした行（`no_fit` は収まらない行。読み方を増やして読み直す行）。 */
      readonly lineIndices: readonly number[]
      readonly reason: string
      readonly suggestions: readonly LineSpanSuggestion[]
    }

type LineInput = { readonly dub?: DialogueDub | undefined; readonly text?: string | undefined }

/** 文字起こしの語。`null` は使えなかった（口が無い・失敗した）、`undefined` は頼んでいない。 */
export type LineTranscript = readonly TranscriptWord[] | null | undefined

const overlaps = (a: DubChunk, b: DubChunk): boolean => a.startSec < b.endSec && b.startSec < a.endSec

const clip = (chunk: DubChunk, span: DubChunk): DubChunk => ({
  startSec: Math.max(chunk.startSec, span.startSec),
  endSec: Math.min(chunk.endSec, span.endSec),
})

const manualSpanOf = (line: LineInput): DubChunk | null =>
  line.dub?.startSec !== undefined && line.dub.endSec !== undefined ? { startSec: line.dub.startSec, endSec: line.dub.endSec } : null

type SpokenLine = {
  readonly lineIndex: number
  readonly text: string
  readonly manual: DubChunk | null
  readonly weight: number
  readonly ttsSec: readonly number[] | null
  /** 口に合わせる行か（置く時刻・収める長さ・切る長さ・元の声のままの行でない）。 */
  readonly lip: boolean
}

/** 手の区間で区切った並び。手の区間の行 1 つか、その間のふつうの行の並び（と、使ってよい時刻の窓）。 */
type Run =
  | { readonly kind: 'manual'; readonly line: SpokenLine & { readonly manual: DubChunk } }
  | { readonly kind: 'auto'; readonly lines: readonly SpokenLine[]; readonly fromSec: number; readonly toSec: number }

const runsOf = (spoken: readonly SpokenLine[]): readonly Run[] => {
  const pieces = spoken.reduce<{ readonly runs: readonly Run[]; readonly pending: readonly SpokenLine[]; readonly fromSec: number }>(
    (acc, line) => {
      if (line.manual === null) return { ...acc, pending: [...acc.pending, line] }
      const manual = line.manual
      const auto: readonly Run[] = acc.pending.length === 0 ? [] : [{ kind: 'auto', lines: acc.pending, fromSec: acc.fromSec, toSec: manual.startSec }]
      return { runs: [...acc.runs, ...auto, { kind: 'manual', line: { ...line, manual } }], pending: [], fromSec: manual.endSec }
    },
    { runs: [], pending: [], fromSec: 0 },
  )
  return pieces.pending.length === 0
    ? pieces.runs
    : [...pieces.runs, { kind: 'auto', lines: pieces.pending, fromSec: pieces.fromSec, toSec: Number.POSITIVE_INFINITY }]
}

const lineNumbers = (lines: readonly SpokenLine[]): string => lines.map((line) => line.lineIndex + 1).join('・')

const roundMs = (sec: number): number => Math.round(sec * 1000) / 1000

/**
 * 区間が足りない並びの、行ごとの手の区間の案。並びの声の区間の頭から尻までを、行の文字数の比で割る。
 * 声の区間が 1 つも無ければ案は出さない（どこを割るか決められない）。
 */
const suggestLineSpans = (window: readonly DubChunk[], lines: readonly SpokenLine[]): readonly LineSpanSuggestion[] => {
  const head = window[0]
  const tail = window[window.length - 1]
  if (head === undefined || tail === undefined || lines.length === 0) return []
  const total = lines.reduce((sum, line) => sum + line.weight, 0)
  const length = tail.endSec - head.startSec
  const edges = lines.reduce<readonly number[]>((acc, line) => [...acc, (acc[acc.length - 1] ?? 0) + line.weight], [0])
  return lines.map((line, k) => ({
    lineIndex: line.lineIndex,
    startSec: roundMs(head.startSec + ((edges[k] ?? 0) / total) * length),
    endSec: roundMs(head.startSec + ((edges[k + 1] ?? total) / total) * length),
  }))
}

const shortageReason = (lines: readonly SpokenLine[], found: number): string =>
  `セリフの ${lineNumbers(lines)} 行目に割り当てる元の声の区間が足りません（見つかったのは ${found} つ。2 人のセリフが続けて 1 つになっている可能性があります）。` +
  '行ごとに「行の区間」を入れてください'

const misfitReason = (lines: readonly SpokenLine[]): string =>
  `セリフの ${lineNumbers(lines)} 行目に、読み上げの長さに合う元の声の区間が見つかりません` +
  `（どの区間に割り当てても、どの読み方でも ${String(DUB_MAX_TEMPO)} 倍を超えて縮める必要があります）。` +
  '読み方の指示を直すか、行ごとに「行の区間」を入れてください'

const ambiguousWarning = (lineIndex: number): LineSpanWarning => ({
  lineIndex,
  warning: {
    code: 'line_span_ambiguous',
    message: `セリフの ${String(lineIndex + 1)} 行目: 元の声のどの区間か決めきれませんでした（ほぼ同じくらい合う区間が別にあります）。ずれていたら「行の区間」を入れてください`,
  },
})

const byLengthWarning = (lineIndex: number, transcript: readonly TranscriptWord[] | null): LineSpanWarning => ({
  lineIndex,
  warning: {
    code: 'line_span_by_length',
    message:
      `セリフの ${String(lineIndex + 1)} 行目: ` +
      (transcript === null ? '文字起こしが使えなかったので' : '文字起こしが行の文と合わなかったので') +
      '、元の声の区間を読み上げの長さで決めました。ずれていたら「行の区間」を入れてください',
  },
})

const isLip = (dub: DialogueDub | undefined): boolean =>
  dub?.keepOriginal !== true && dub?.placeAtSec === undefined && dub?.fitSec === undefined && dub?.cutSec === undefined

type AutoResult =
  | { readonly ok: true; readonly groups: readonly ChunkGroup[]; readonly warnings: readonly LineSpanWarning[] }
  | Extract<AssignResult, { ok: false }>

const shortage = (window: readonly DubChunk[], lines: readonly SpokenLine[]): Extract<AssignResult, { ok: false }> => ({
  ok: false,
  cause: 'shortage',
  lineIndices: lines.map((line) => line.lineIndex),
  reason: shortageReason(lines, window.length),
  suggestions: suggestLineSpans(window, lines),
})

/** 読み上げの長さで割り当てる。迷えば警告、収まらなければ止める。 */
const autoByLength = (window: readonly DubChunk[], lines: readonly SpokenLine[]): AutoResult => {
  const lengthLines: readonly LengthLine[] = lines.map((line) => ({ lineIndex: line.lineIndex, ttsSec: line.ttsSec, lip: line.lip }))
  const [best, second] = assignByLength(window, lengthLines)
  if (best === undefined) return shortage(window, lines)
  if (best.misfits.length > 0) {
    const misfits = lines.filter((line) => best.misfits.includes(line.lineIndex))
    const suggestions = suggestLineSpans(window, lines)
    return { ok: false, cause: 'no_fit', lineIndices: best.misfits, reason: misfitReason(misfits), suggestions }
  }
  const close = second !== undefined && second.cost - best.cost < ASSIGN_AMBIGUITY_MARGIN
  const warnings = close
    ? lines.flatMap((line, k) => {
        const a = best.runs[k]
        const b = second.runs[k]
        return a?.[0] === b?.[0] && a?.[1] === b?.[1] ? [] : [ambiguousWarning(line.lineIndex)]
      })
    : []
  return { ok: true, groups: best.runs.map(([from, to]) => window.slice(from, to)), warnings }
}

const autoWithoutText = (window: readonly DubChunk[], lines: readonly SpokenLine[]): AutoResult =>
  lines.some((line) => line.ttsSec !== null) ? autoByLength(window, lines) : { ok: true, groups: mergeChunksTo(window, lines.length), warnings: [] }

/** 並びの時刻に入る語（語の真ん中で決める）。 */
const wordsIn = (transcript: readonly TranscriptWord[], fromSec: number, toSec: number): readonly TranscriptWord[] =>
  transcript.filter((word) => {
    const middle = (word.startSec + word.endSec) / 2
    return middle >= fromSec && middle < toSec
  })

const autoAssign = (
  window: readonly DubChunk[],
  lines: readonly SpokenLine[],
  transcript: LineTranscript,
  range: { readonly fromSec: number; readonly toSec: number },
): AutoResult => {
  if (window.length < lines.length) {
    return shortage(window, lines)
  }
  if (transcript === undefined) return autoWithoutText(window, lines)
  const byText =
    transcript === null
      ? null
      : assignByText(
          window,
          wordsIn(transcript, range.fromSec, range.toSec),
          lines.map((line) => ({ lineIndex: line.lineIndex, text: line.text, ttsSec: line.ttsSec })),
        )
  if (byText !== null) return { ok: true, groups: byText.groups, warnings: byText.ambiguous.map(ambiguousWarning) }
  const fallback = autoWithoutText(window, lines)
  return fallback.ok
    ? { ...fallback, warnings: [...lines.map((line) => byLengthWarning(line.lineIndex, transcript)), ...fallback.warnings] }
    : fallback
}

/**
 * 手の区間の行で並びを区切り、その間のふつうの行には、その間の時刻にある声の区間だけを割り当てる
 * （**手の区間をまたいでつながない**。またぐと、ふつうの行の区間が手の区間に重なる）。
 */
export const assignLines = (
  chunks: readonly DubChunk[],
  lines: readonly LineInput[],
  ttsSec?: LineTtsLengths,
  transcript?: LineTranscript,
): AssignResult => {
  const spoken = lines
    .map(
      (line, lineIndex): SpokenLine => ({
        lineIndex,
        text: line.text ?? '',
        manual: manualSpanOf(line),
        weight: Math.max(1, [...(line.text ?? '')].length),
        ttsSec: ttsSec?.get(lineIndex) ?? null,
        lip: isLip(line.dub),
      }),
    )
    .filter((_, i) => lines[i]?.dub?.added !== true)
  const manualSpans = spoken.flatMap((line) => (line.manual === null ? [] : [line.manual]))
  const free = chunks.filter((chunk) => !manualSpans.some((span) => overlaps(chunk, span)))
  return runsOf(spoken).reduce<AssignResult>(
    (acc, run) => {
      if (!acc.ok) return acc
      if (run.kind === 'manual') {
        const manual = run.line.manual
        const inside = chunks.filter((chunk) => overlaps(chunk, manual)).map((chunk) => clip(chunk, manual))
        return { ...acc, spans: [...acc.spans, { lineIndex: run.line.lineIndex, ...manual, source: 'manual', chunks: inside }] }
      }
      const window = free.filter((chunk) => chunk.startSec >= run.fromSec && chunk.endSec <= run.toSec)
      const auto = autoAssign(window, run.lines, transcript, run)
      if (!auto.ok) return auto
      const spans = run.lines.map((line, k): LineSpan => {
        const group = auto.groups[k] ?? []
        return { lineIndex: line.lineIndex, ...spanOf(group), source: 'chunks', chunks: group }
      })
      return { ok: true, spans: [...acc.spans, ...spans], warnings: [...acc.warnings, ...auto.warnings] }
    },
    { ok: true, spans: [], warnings: [] },
  )
}
