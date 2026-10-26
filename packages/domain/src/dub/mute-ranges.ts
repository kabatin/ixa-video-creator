import { roundMs, type DubChunk } from './speech-chunks.js'

/**
 * 元の声を消す範囲（ADR-0062）。行の [始まり -0.05, 終わり +0.1] を消し、前後 0.3 秒以内の声の区間まで広げる
 * （声の消し残しを出さない）。消すのは声の区間だけで、物音・環境音は残る。
 *
 * - `keepOriginal` の行は消さない。その行の区間には他の行の範囲も広げない（残す声を消さない）
 * - `snap: false` の行は広げない
 */

export const DUB_MUTE_LEAD_SEC = 0.05
export const DUB_MUTE_TAIL_SEC = 0.1
export const DUB_MUTE_SNAP_SEC = 0.3

export type MuteLine = {
  readonly startSec: number
  readonly endSec: number
  readonly snap?: boolean | undefined
  readonly keepOriginal?: boolean | undefined
}

const overlaps = (a: DubChunk, b: DubChunk): boolean => a.startSec < b.endSec && b.startSec < a.endSec

const widen = (range: DubChunk, chunks: readonly DubChunk[]): DubChunk =>
  chunks
    .filter((chunk) => chunk.endSec >= range.startSec - DUB_MUTE_SNAP_SEC && chunk.startSec <= range.endSec + DUB_MUTE_SNAP_SEC)
    .reduce(
      (acc, chunk) => ({ startSec: Math.min(acc.startSec, chunk.startSec), endSec: Math.max(acc.endSec, chunk.endSec) }),
      range,
    )

const mergeRanges = (ranges: readonly DubChunk[]): readonly DubChunk[] =>
  [...ranges]
    .sort((a, b) => a.startSec - b.startSec)
    .reduce<readonly DubChunk[]>((acc, range) => {
      const previous = acc[acc.length - 1]
      if (previous !== undefined && range.startSec <= previous.endSec) {
        return [...acc.slice(0, -1), { startSec: previous.startSec, endSec: Math.max(previous.endSec, range.endSec) }]
      }
      return [...acc, range]
    }, [])

export const muteRanges = (lines: readonly MuteLine[], chunks: readonly DubChunk[]): readonly DubChunk[] => {
  const kept = lines.filter((line) => line.keepOriginal === true)
  const snappable = chunks.filter((chunk) => !kept.some((line) => overlaps(chunk, line)))
  const ranges = lines
    .filter((line) => line.keepOriginal !== true)
    .map((line) => {
      const base = { startSec: Math.max(0, line.startSec - DUB_MUTE_LEAD_SEC), endSec: line.endSec + DUB_MUTE_TAIL_SEC }
      return line.snap === false ? base : widen(base, snappable)
    })
  return mergeRanges(ranges).map((range) => ({ startSec: roundMs(range.startSec), endSec: roundMs(range.endSec) }))
}
