import { DUB_MAX_TEMPO } from './chunk-tempo.js'
import type { DubChunk } from './speech-chunks.js'

/**
 * 声の区間を、読み上げの長さで行に割り当てる（ADR-0062）。純粋。
 *
 * - 行の順は変えない。1 行は続いた区間の並び（1 つ以上）を受け持つ
 * - 行の前・間・後ろの区間は飛ばしてよい（クリック・環境音）
 * - 費用 = Σ|log(元の声の長さ ÷ 読み上げの長さ)| + 飛ばした声の長さ × 小さな重み + 行の中の途切れ × 重み
 *   + 0.25 秒未満の並び（読み上げがそれほど短くないとき）
 * - 口に合わせる行は、どの読み方でも 1.6 倍を超える並びを外れ（大きな費用）とする。0.8 倍未満は外れにしない
 *   （H3 がゆっくり話した行。置く段で 0.8 倍に丸めて警告する。前と同じ）
 * - 一番良い割り当てと次に良い割り当てを動的計画法で求める（迷いの警告に使う）
 *
 * 文字起こし（faster-whisper）の語の時刻は、実の H3 の Take で 1 行目を 1.04〜4.76 秒と大きく外したので使わない。
 */

export type LengthLine = {
  readonly lineIndex: number
  /** 読み上げの声の長さ（読み方ごと）。無い行（元の声のままの行）は長さを比べない。 */
  readonly ttsSec: readonly number[] | null
  /** 口に合わせる行か（1.6 倍以下に収まることを求める）。 */
  readonly lip: boolean
}

/** 飛ばした声 1 秒あたりの費用。 */
export const ASSIGN_SKIP_WEIGHT = 0.2
/** 1 行の中の途切れ 1 秒あたりの費用（離れた区間をつながない）。 */
export const ASSIGN_GAP_WEIGHT = 0.5
/** これより短い並びは、読み上げもこれより短くなければ選びにくくする。 */
export const ASSIGN_SHORT_RUN_SEC = 0.25
const SHORT_RUN_PENALTY = 1
/** 一番良い割り当てと次の割り当ての費用の差がこれ未満なら、迷いの警告を付ける。 */
export const ASSIGN_AMBIGUITY_MARGIN = 0.1
const MISFIT_PENALTY = 1000
const EPS = 1e-9

/** 割り当ての案。`runs[k]` は k 行目が受け持つ区間の [頭, 尻の次) の番号。 */
export type LengthAssignment = {
  readonly cost: number
  readonly runs: readonly (readonly [number, number])[]
  /** 1.6 倍以下に収まらない行（`lineIndex`）。 */
  readonly misfits: readonly number[]
}

const durationOf = (chunk: DubChunk | undefined): number => (chunk === undefined ? 0 : chunk.endSec - chunk.startSec)

/** 0.8 倍未満は収まるとみなす（置く段で 0.8 に丸める）。 */
const fits = (ratio: number): boolean => ratio <= DUB_MAX_TEMPO + EPS

type RunCost = { readonly cost: number; readonly misfit: boolean }

const runCost = (chunks: readonly DubChunk[], line: LengthLine, from: number, to: number): RunCost => {
  const run = chunks.slice(from, to)
  const voiced = run.reduce((sum, chunk) => sum + durationOf(chunk), 0)
  const gaps = run.slice(1).reduce((sum, chunk, k) => sum + (chunk.startSec - (run[k]?.endSec ?? chunk.startSec)), 0)
  const gapCost = ASSIGN_GAP_WEIGHT * gaps
  const readings = (line.ttsSec ?? []).filter((sec) => sec > 0)
  if (readings.length === 0 || !(voiced > 0)) return { cost: gapCost, misfit: line.lip && line.ttsSec !== null }
  const ratioCost = Math.min(...readings.map((sec) => Math.abs(Math.log(voiced / sec))))
  const misfit = line.lip && !readings.some((sec) => fits(sec / voiced))
  const short = voiced < ASSIGN_SHORT_RUN_SEC && Math.min(...readings) >= ASSIGN_SHORT_RUN_SEC ? SHORT_RUN_PENALTY : 0
  return { cost: ratioCost + gapCost + short + (misfit ? MISFIT_PENALTY : 0), misfit }
}

/** 費用の低い順に 2 つまで（同じ費用なら先に来たもの）。 */
const topTwo = (candidates: readonly LengthAssignment[]): readonly LengthAssignment[] =>
  [...candidates].sort((a, b) => a.cost - b.cost).slice(0, 2)

const skipped = (assignment: LengthAssignment, chunk: DubChunk | undefined): LengthAssignment => ({
  ...assignment,
  cost: assignment.cost + ASSIGN_SKIP_WEIGHT * durationOf(chunk),
})

/**
 * 一番良い割り当てと次に良い割り当て（費用の低い順）。区間が行より少なければ空。
 * `table[k][p]` = 先頭の k 行を、先頭の p 個の区間の中に割り当てる案の上位 2 つ。
 */
export const assignByLength = (chunks: readonly DubChunk[], lines: readonly LengthLine[]): readonly LengthAssignment[] => {
  const n = chunks.length
  const first = Array.from({ length: n + 1 }, (_, p): readonly LengthAssignment[] => [
    { cost: ASSIGN_SKIP_WEIGHT * chunks.slice(0, p).reduce((sum, chunk) => sum + durationOf(chunk), 0), runs: [], misfits: [] },
  ])
  const table = lines.reduce<readonly (readonly (readonly LengthAssignment[])[])[]>(
    (rows, line, k) => {
      const previous = rows[k] ?? []
      const row = Array.from({ length: n + 1 }).reduce<readonly (readonly LengthAssignment[])[]>((acc, _, p) => {
        if (p < k + 1) return [...acc, []]
        const viaSkip = (acc[p - 1] ?? []).map((assignment) => skipped(assignment, chunks[p - 1]))
        const viaRun = Array.from({ length: p - k }, (_, offset) => k + offset).flatMap((from) => {
          const cost = runCost(chunks, line, from, p)
          return (previous[from] ?? []).map(
            (assignment): LengthAssignment => ({
              cost: assignment.cost + cost.cost,
              runs: [...assignment.runs, [from, p] as const],
              misfits: cost.misfit ? [...assignment.misfits, line.lineIndex] : assignment.misfits,
            }),
          )
        })
        return [...acc, topTwo([...viaSkip, ...viaRun])]
      }, [])
      return [...rows, row]
    },
    [first],
  )
  return table[lines.length]?.[n] ?? []
}
