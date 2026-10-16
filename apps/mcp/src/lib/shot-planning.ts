import { DurationNotSupportedError, quantizeDuration, type DurationSupport } from '@ixa/domain'

/**
 * Shot 割りの境界を決める純粋関数（`plan_shots`）。
 *
 * - 境界（カット点）を直接もらうか、尺の列から積み上げる
 * - 頼まれたら近くの拍・小節頭へ寄せる（`maxShiftSec` を超えて動かさない）
 * - 生成モデルが分かれば、各 Shot をどの尺で作るか（モデルが出せる尺へ切り上げ）を添える。
 *   規則は domain の `quantizeDuration` 1 か所（写さない）
 */

export type PlanInput =
  | { readonly kind: 'cuts'; readonly boundariesSec: readonly number[] }
  | { readonly kind: 'durations'; readonly startSec: number; readonly durationsSec: readonly number[] }

/** 浮動小数の足し算の誤差を消す（秒は 1/1000 まで）。 */
const ms = (value: number): number => Math.round(value * 1000) / 1000

export const boundariesFrom = (input: PlanInput): readonly number[] => {
  if (input.kind === 'cuts') return input.boundariesSec.map(ms)
  return input.durationsSec.reduce<readonly number[]>(
    (acc, duration) => [...acc, ms((acc[acc.length - 1] as number) + duration)],
    [ms(input.startSec)],
  )
}

/** いちばん近い格子点。`maxShiftSec` より遠ければ動かさない。 */
export const snapTo = (value: number, grid: readonly number[], maxShiftSec: number): number => {
  const nearest = grid.reduce<number | null>(
    (best, point) => (best === null || Math.abs(point - value) < Math.abs(best - value) ? point : best),
    null,
  )
  return nearest !== null && Math.abs(nearest - value) <= maxShiftSec ? ms(nearest) : value
}

export type SnapResult = {
  readonly boundariesSec: readonly number[]
  /** 寄せた結果、隣と重なって消えた境界。 */
  readonly dropped: readonly number[]
}

/** 境界をまとめて寄せる。寄せた結果の重なり・逆転は落として、昇順を保つ。 */
export const snapBoundaries = (
  boundariesSec: readonly number[],
  grid: readonly number[],
  maxShiftSec: number,
): SnapResult => {
  const snapped = boundariesSec.map((b) => snapTo(b, grid, maxShiftSec))
  return snapped.reduce<SnapResult>(
    (acc, b, i) => {
      const last = acc.boundariesSec[acc.boundariesSec.length - 1]
      return last !== undefined && b <= last
        ? { ...acc, dropped: [...acc.dropped, boundariesSec[i] as number] }
        : { ...acc, boundariesSec: [...acc.boundariesSec, b] }
    },
    { boundariesSec: [], dropped: [] },
  )
}

/** 境界が昇順で、2 つ以上あるか。違えば理由の文。 */
export const boundaryProblem = (boundariesSec: readonly number[]): string | null => {
  if (boundariesSec.length < 2) return '境界は 2 つ以上必要です（最初のカットの頭と最後のカットの終わり）'
  const unordered = boundariesSec.findIndex((b, i) => i > 0 && b <= (boundariesSec[i - 1] as number))
  return unordered === -1 ? null : `境界が昇順ではありません（${String(unordered)} 番目: ${String(boundariesSec[unordered])}）`
}

export type PlannedShot = {
  readonly startSec: number
  readonly durationSec: number
  /** モデルを指定したとき、その尺で作る長さ。作れなければ null。 */
  readonly generateSec?: number | null
  readonly note?: string
}

export const plannedShots = (
  boundariesSec: readonly number[],
  support: DurationSupport | null,
): readonly PlannedShot[] =>
  boundariesSec.slice(0, -1).map((startSec, i) => {
    const durationSec = ms((boundariesSec[i + 1] as number) - startSec)
    if (support === null) return { startSec, durationSec }
    try {
      const generateSec = ms(quantizeDuration(durationSec, support))
      return generateSec < durationSec
        ? { startSec, durationSec, generateSec, note: 'slowed to fit (timing=fit)' }
        : { startSec, durationSec, generateSec }
    } catch (error) {
      if (error instanceof DurationNotSupportedError) {
        return { startSec, durationSec, generateSec: null, note: error.message }
      }
      throw error
    }
  })
