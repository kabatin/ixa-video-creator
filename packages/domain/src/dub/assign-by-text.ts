import type { ChunkGroup } from './pair-chunks.js'
import type { DubChunk } from './speech-chunks.js'
import { foreignCount, matchSimilarity, normalizeForMatch } from './text-similarity.js'

/**
 * 声の区間を、文字起こしの語で行に割り当てる（ADR-0062）。純粋。
 *
 * 1. 語を行の順に、続いた語の並びで受け持たせる（動的計画法）。費用 = Σ(1 − 近さ) + 行に無い文字 × 重み
 *    + 飛ばした語の文字 × 小さな重み。行の前・間・後ろの語は飛ばしてよい（「はっ」のような息・物音）
 * 2. 語の時刻は境目がずれる（無音の所まで語が伸びる）ので、そのまま区間にしない。各声の区間を、重なる語の
 *    多い行に渡し（どの語にも重ならなければ 0.15 秒以内の一番近い行）、行の区間 = 受け持った声の区間のつながり。
 *    飛ばした語にしか重ならない声の区間はどの行にも渡さない
 * 3. 上位 2 つの語の割り当てがほとんど同じ費用で区間が違えば、読み上げの長さで決める（長さが無ければ迷いとして返す）
 *
 * どれかの行の近さが 0.3 未満・区間を 1 つも受け持たない行がある・順が入れ替わるなら、決めない（null）。
 */

export type TranscriptWord = { readonly startSec: number; readonly endSec: number; readonly text: string }

export type TextLine = {
  readonly lineIndex: number
  readonly text: string
  /** 読み上げの声の長さ（読み方ごと）。迷ったときの決め手。無ければ null。 */
  readonly ttsSec: readonly number[] | null
}

export type TextAssignment = {
  readonly groups: readonly ChunkGroup[]
  /** 決めきれなかった行（`lineIndex`）。 */
  readonly ambiguous: readonly number[]
}

/** この近さ未満の行があれば、文字起こしでは決めない。 */
export const TEXT_MIN_SIMILARITY = 0.3
/** 飛ばした語の文字 1 つあたりの費用。 */
export const TEXT_SKIP_WEIGHT = 0.02
/** 行に無い文字 1 つあたりの費用（息・物音の語を行の端に付けない。長い行では 1 文字の違いが近さにほとんど出ない）。 */
export const TEXT_FOREIGN_WEIGHT = 0.1
/** 上位 2 つの費用の差がこれ未満なら、読み上げの長さで決める。 */
export const TEXT_AMBIGUITY_MARGIN = 0.05
/** どの語にも重ならない声の区間を、この秒以内の語の行に渡す（語の時刻のずれ）。 */
export const WORD_SNAP_TOLERANCE_SEC = 0.15

type Word = TranscriptWord & { readonly norm: string }
type Alignment = { readonly cost: number; readonly runs: readonly (readonly [number, number])[]; readonly sims: readonly number[] }

const groupText = (words: readonly Word[], from: number, to: number): string =>
  words
    .slice(from, to)
    .map((word) => word.norm)
    .join('')

const topTwo = (candidates: readonly Alignment[]): readonly Alignment[] => [...candidates].sort((a, b) => a.cost - b.cost).slice(0, 2)

/** 語の割り当ての上位 2 つ。`table[k][p]` = 先頭の k 行を先頭の p 語の中に割り当てる案。 */
const alignWords = (words: readonly Word[], lines: readonly string[]): readonly Alignment[] => {
  const m = words.length
  const skipCost = (p: number): number => TEXT_SKIP_WEIGHT * [...(words[p - 1]?.norm ?? '')].length
  const first = Array.from({ length: m + 1 }, (_, p): readonly Alignment[] => [
    { cost: words.slice(0, p).reduce((sum, _w, i) => sum + skipCost(i + 1), 0), runs: [], sims: [] },
  ])
  const table = lines.reduce<readonly (readonly (readonly Alignment[])[])[]>(
    (rows, line, k) => {
      const previous = rows[k] ?? []
      const row = Array.from({ length: m + 1 }).reduce<readonly (readonly Alignment[])[]>((acc, _, p) => {
        if (p < k + 1) return [...acc, []]
        const viaSkip = (acc[p - 1] ?? []).map((a): Alignment => ({ ...a, cost: a.cost + skipCost(p) }))
        const viaRun = Array.from({ length: p - k }, (_, offset) => k + offset).flatMap((from) => {
          const text = groupText(words, from, p)
          const sim = matchSimilarity(text, line)
          const cost = 1 - sim + TEXT_FOREIGN_WEIGHT * foreignCount(text, line)
          return (previous[from] ?? []).map(
            (a): Alignment => ({ cost: a.cost + cost, runs: [...a.runs, [from, p] as const], sims: [...a.sims, sim] }),
          )
        })
        return [...acc, topTwo([...viaSkip, ...viaRun])]
      }, [])
      return [...rows, row]
    },
    [first],
  )
  return table[lines.length]?.[m] ?? []
}

const overlapSec = (chunk: DubChunk, word: TranscriptWord): number =>
  Math.max(0, Math.min(chunk.endSec, word.endSec) - Math.max(chunk.startSec, word.startSec))

const distanceSec = (chunk: DubChunk, word: TranscriptWord): number =>
  Math.max(0, word.startSec - chunk.endSec, chunk.startSec - word.endSec)

/** 声の区間を受け持つ行の番号（`runs` の番号）。どの行にも渡さなければ null。 */
const ownerOf = (chunk: DubChunk, words: readonly Word[], runs: readonly (readonly [number, number])[]): number | null => {
  const skippedOverlap = words.reduce((sum, word, i) => (runs.some(([from, to]) => i >= from && i < to) ? sum : sum + overlapSec(chunk, word)), 0)
  const scored = runs.map(([from, to], k) => {
    const own = words.slice(from, to)
    return { k, overlap: own.reduce((sum, word) => sum + overlapSec(chunk, word), 0), distance: Math.min(...own.map((w) => distanceSec(chunk, w))) }
  })
  const byOverlap = scored.reduce((best, s) => (s.overlap > best.overlap ? s : best), { k: -1, overlap: 0, distance: Number.POSITIVE_INFINITY })
  if (byOverlap.k >= 0) return byOverlap.k
  if (skippedOverlap > 0) return null
  const nearest = scored.reduce((best, s) => (s.distance < best.distance ? s : best), { k: -1, overlap: 0, distance: WORD_SNAP_TOLERANCE_SEC + 1e-9 })
  return nearest.k >= 0 ? nearest.k : null
}

/** 語の割り当てを声の区間に写す。受け持たない行がある・順が入れ替わるなら null。 */
const snapToChunks = (chunks: readonly DubChunk[], words: readonly Word[], alignment: Alignment): readonly ChunkGroup[] | null => {
  const owners = chunks.map((chunk) => ownerOf(chunk, words, alignment.runs))
  const groups = alignment.runs.map((_, k) => chunks.filter((_c, i) => owners[i] === k))
  const ordered = owners.filter((owner): owner is number => owner !== null).every((owner, i, all) => i === 0 || owner >= (all[i - 1] ?? 0))
  return ordered && groups.every((group) => group.length > 0) ? groups : null
}

const lengthCost = (groups: readonly ChunkGroup[], lines: readonly TextLine[]): number =>
  groups.reduce((sum, group, k) => {
    const voiced = group.reduce((total, chunk) => total + (chunk.endSec - chunk.startSec), 0)
    const readings = (lines[k]?.ttsSec ?? []).filter((sec) => sec > 0)
    return readings.length === 0 || !(voiced > 0) ? sum : sum + Math.min(...readings.map((sec) => Math.abs(Math.log(voiced / sec))))
  }, 0)

const hasLengths = (lines: readonly TextLine[]): boolean => lines.some((line) => (line.ttsSec ?? []).some((sec) => sec > 0))

const sameGroup = (a: ChunkGroup | undefined, b: ChunkGroup | undefined): boolean =>
  a?.length === b?.length && (a ?? []).every((chunk, i) => chunk === b?.[i])

type Candidate = { readonly alignment: Alignment; readonly groups: readonly ChunkGroup[] }

/** 上位 2 つが近ければ読み上げの長さで決める。長さが無ければ、区間の違う行を迷いとして返す。 */
const decide = (candidates: readonly Candidate[], lines: readonly TextLine[]): TextAssignment | null => {
  const [best, second] = candidates
  if (best === undefined) return null
  if (second === undefined || second.alignment.cost - best.alignment.cost >= TEXT_AMBIGUITY_MARGIN) return { groups: best.groups, ambiguous: [] }
  const differing = lines.flatMap((line, k) => (sameGroup(best.groups[k], second.groups[k]) ? [] : [line.lineIndex]))
  if (differing.length === 0) return { groups: best.groups, ambiguous: [] }
  if (!hasLengths(lines)) return { groups: best.groups, ambiguous: differing }
  const a = lengthCost(best.groups, lines)
  const b = lengthCost(second.groups, lines)
  return { groups: (b < a ? second : best).groups, ambiguous: [] }
}

/** 文字起こしの語で、声の区間を行に割り当てる。決められなければ null（読み上げの長さに任せる）。 */
export const assignByText = (
  chunks: readonly DubChunk[],
  transcript: readonly TranscriptWord[],
  lines: readonly TextLine[],
): TextAssignment | null => {
  const words: readonly Word[] = transcript.map((word) => ({ ...word, norm: normalizeForMatch(word.text) })).filter((word) => word.norm.length > 0)
  const targets = lines.map((line) => normalizeForMatch(line.text))
  if (lines.length === 0 || words.length < lines.length || targets.some((text) => text.length === 0)) return null
  const candidates = alignWords(words, targets)
    .filter((alignment) => alignment.sims.every((sim) => sim >= TEXT_MIN_SIMILARITY))
    .flatMap((alignment): readonly Candidate[] => {
      const groups = snapToChunks(chunks, words, alignment)
      return groups === null ? [] : [{ alignment, groups }]
    })
  return decide(candidates, lines)
}
