import type { DubChunk } from './speech-chunks.js'

/**
 * 読み上げの区間と元の声の区間を 1 対 1 に組む（ADR-0062）。数が違えば、多い方を
 * すき間の短い所からつないで数をそろえる（AnimalVideo と同じ）。
 */

/** 区間をまとめた 1 組（中の区間は残す。読み上げの側は組の中の間を詰めるのに使う）。 */
export type ChunkGroup = readonly DubChunk[]

export const spanOf = (group: ChunkGroup): DubChunk => ({
  startSec: group[0]?.startSec ?? 0,
  endSec: group[group.length - 1]?.endSec ?? 0,
})

/** すき間の一番短い所（同じならば前）。 */
const shortestGapIndex = (groups: readonly ChunkGroup[]): number =>
  groups.slice(0, -1).reduce(
    (best, group, index) => {
      const gap = (groups[index + 1]?.[0]?.startSec ?? 0) - (group[group.length - 1]?.endSec ?? 0)
      return gap < best.gap ? { index, gap } : best
    },
    { index: 0, gap: Number.POSITIVE_INFINITY },
  ).index

const mergeGroups = (groups: readonly ChunkGroup[], count: number): readonly ChunkGroup[] => {
  if (groups.length <= Math.max(1, count)) return groups
  const at = shortestGapIndex(groups)
  const merged = [...(groups[at] ?? []), ...(groups[at + 1] ?? [])]
  return mergeGroups([...groups.slice(0, at), merged, ...groups.slice(at + 2)], count)
}

/** 区間を `count` 個の組にまとめる。もともと `count` 個以下なら 1 つずつの組。 */
export const mergeChunksTo = (chunks: readonly DubChunk[], count: number): readonly ChunkGroup[] =>
  mergeGroups(
    chunks.map((chunk) => [chunk]),
    count,
  )

export type ChunkPair = {
  /** 読み上げの区間（つないだときは中の区間を残す）。 */
  readonly tts: ChunkGroup
  /** 元の声の区間（つないだときは頭から尻まで）。 */
  readonly source: DubChunk
}

export type PairResult = {
  readonly pairs: readonly ChunkPair[]
  /** つながずに組めたか（数が違えば false。一致率で読み方を選ぶときの手がかり）。 */
  readonly countsMatched: boolean
}

export const pairChunks = (tts: readonly DubChunk[], source: readonly DubChunk[]): PairResult => {
  const count = Math.min(tts.length, source.length)
  if (count === 0) return { pairs: [], countsMatched: tts.length === source.length }
  const ttsGroups = mergeChunksTo(tts, count)
  const sourceGroups = mergeChunksTo(source, count)
  return {
    pairs: ttsGroups.map((group, index) => ({ tts: group, source: spanOf(sourceGroups[index] ?? []) })),
    countsMatched: tts.length === source.length,
  }
}
