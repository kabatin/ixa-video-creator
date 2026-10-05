import type { CharTime } from './char-timing.js'
import type { TimedTelopChunk } from './telop-chunks.js'

/**
 * ナレーションのテロップをタイムラインの秒にする（ADR-0038）。
 * 行の位置 + 枚の時刻。行の最後の枚は読み終わりに少し残す（すぐ消えると読み切れない）が、次のテロップには重ねない。
 */

/** 読み終わってからテロップを残す長さ。 */
export const NARRATION_TELOP_HOLD_SEC = 0.3

export type NarrationTelopSource = {
  readonly lineId: string
  /** 行の位置（タイムラインの秒）。 */
  readonly startSec: number
  readonly chunks: readonly TimedTelopChunk[]
}

export type NarrationTelopSpan = {
  readonly lineId: string
  readonly chunkIndex: number
  readonly text: string
  readonly startSec: number
  readonly durationSec: number
  /** 字の時刻（この枚の頭からの秒）。 */
  readonly chars: readonly CharTime[] | null
}

const roundMs = (seconds: number): number => Math.round(seconds * 1000) / 1000

export const narrationTelopSpans = (lines: readonly NarrationTelopSource[]): readonly NarrationTelopSpan[] => {
  const spans = lines
    .flatMap((line) =>
      line.chunks.map((chunk, chunkIndex) => ({
        lineId: line.lineId,
        chunkIndex,
        text: chunk.text,
        startSec: line.startSec + chunk.startSec,
        endSec: line.startSec + chunk.startSec + chunk.durationSec,
        last: chunkIndex === line.chunks.length - 1,
        chars: chunk.chars,
      })),
    )
    .sort((a, b) => a.startSec - b.startSec)
  return spans.map((span, index) => {
    const nextStart = spans.slice(index + 1).find((other) => other.startSec >= span.startSec)?.startSec ?? Number.POSITIVE_INFINITY
    const endSec = span.last ? Math.max(span.endSec, Math.min(span.endSec + NARRATION_TELOP_HOLD_SEC, nextStart)) : span.endSec
    return {
      lineId: span.lineId,
      chunkIndex: span.chunkIndex,
      text: span.text,
      startSec: roundMs(span.startSec),
      durationSec: roundMs(endSec - span.startSec),
      chars: span.chars,
    }
  })
}
