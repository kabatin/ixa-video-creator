import type { DialogueDub } from './dialogue-dub.js'
import { mergeChunksTo, spanOf } from './pair-chunks.js'
import type { DubChunk } from './speech-chunks.js'

/**
 * 行の区間（ADR-0062）。H3 が話した元の声の区間を、セリフの行に割り当てる。
 *
 * - 足す行（`added`）は数えない（H3 は話していない）
 * - 行の手の区間（`startSec`/`endSec`）があればそれを使う。その区間に掛かる声の区間は他の行に回さない
 * - 残りの行には、残りの声の区間を、すき間の短い所からつないで行の数にそろえて順に割り当てる
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

export type AssignResult = { readonly ok: true; readonly spans: readonly LineSpan[] } | { readonly ok: false; readonly reason: string }

type LineInput = { readonly dub?: DialogueDub | undefined }

const overlaps = (a: DubChunk, b: DubChunk): boolean => a.startSec < b.endSec && b.startSec < a.endSec

const clip = (chunk: DubChunk, span: DubChunk): DubChunk => ({
  startSec: Math.max(chunk.startSec, span.startSec),
  endSec: Math.min(chunk.endSec, span.endSec),
})

const manualSpanOf = (line: LineInput): DubChunk | null =>
  line.dub?.startSec !== undefined && line.dub.endSec !== undefined ? { startSec: line.dub.startSec, endSec: line.dub.endSec } : null

type SpokenLine = { readonly lineIndex: number; readonly manual: DubChunk | null }

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

const shortageReason = (lines: readonly SpokenLine[], found: number): string =>
  `セリフの ${lineNumbers(lines)} 行目に割り当てる元の声の区間が足りません（見つかったのは ${found} つ。2 人のセリフが続けて 1 つになっている可能性があります）。` +
  '行ごとに「行の区間」を入れてください'

/**
 * 手の区間の行で並びを区切り、その間のふつうの行には、その間の時刻にある声の区間だけを割り当てる
 * （**手の区間をまたいでつながない**。またぐと、ふつうの行の区間が手の区間に重なる）。
 */
export const assignLines = (chunks: readonly DubChunk[], lines: readonly LineInput[]): AssignResult => {
  const spoken = lines.map((line, lineIndex) => ({ lineIndex, manual: manualSpanOf(line) })).filter((_, i) => lines[i]?.dub?.added !== true)
  const manualSpans = spoken.flatMap((line) => (line.manual === null ? [] : [line.manual]))
  const free = chunks.filter((chunk) => !manualSpans.some((span) => overlaps(chunk, span)))
  return runsOf(spoken).reduce<AssignResult>(
    (acc, run) => {
      if (!acc.ok) return acc
      if (run.kind === 'manual') {
        const manual = run.line.manual
        const inside = chunks.filter((chunk) => overlaps(chunk, manual)).map((chunk) => clip(chunk, manual))
        return { ok: true, spans: [...acc.spans, { lineIndex: run.line.lineIndex, ...manual, source: 'manual', chunks: inside }] }
      }
      const window = free.filter((chunk) => chunk.startSec >= run.fromSec && chunk.endSec <= run.toSec)
      if (window.length < run.lines.length) return { ok: false, reason: shortageReason(run.lines, window.length) }
      const groups = mergeChunksTo(window, run.lines.length)
      const spans = run.lines.map((line, k): LineSpan => {
        const group = groups[k] ?? []
        return { lineIndex: line.lineIndex, ...spanOf(group), source: 'chunks', chunks: group }
      })
      return { ok: true, spans: [...acc.spans, ...spans] }
    },
    { ok: true, spans: [] },
  )
}
