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

export const assignLines = (chunks: readonly DubChunk[], lines: readonly LineInput[]): AssignResult => {
  const spoken = lines.map((line, lineIndex) => ({ lineIndex, manual: manualSpanOf(line) })).filter((_, i) => lines[i]?.dub?.added !== true)
  const manualSpans = spoken.flatMap((line) => (line.manual === null ? [] : [line.manual]))
  const free = chunks.filter((chunk) => !manualSpans.some((span) => overlaps(chunk, span)))
  const autoCount = spoken.filter((line) => line.manual === null).length
  if (free.length < autoCount) {
    return {
      ok: false,
      reason: `元の声の区間が ${free.length} つしか見つからず、セリフの ${autoCount} 行に割り当てられません。行ごとに「行の区間」を入れてください`,
    }
  }
  const groups = mergeChunksTo(free, autoCount)
  const assigned = spoken.reduce<{ readonly spans: readonly LineSpan[]; readonly next: number }>(
    (acc, line) => {
      if (line.manual !== null) {
        const manual = line.manual
        const inside = chunks.filter((chunk) => overlaps(chunk, manual)).map((chunk) => clip(chunk, manual))
        return { spans: [...acc.spans, { lineIndex: line.lineIndex, ...manual, source: 'manual', chunks: inside }], next: acc.next }
      }
      const group = groups[acc.next] ?? []
      return { spans: [...acc.spans, { lineIndex: line.lineIndex, ...spanOf(group), source: 'chunks', chunks: group }], next: acc.next + 1 }
    },
    { spans: [], next: 0 },
  )
  return { ok: true, spans: assigned.spans }
}
