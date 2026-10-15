import type { WireBulkUpscaleResult } from '@/lib/shot-bulk-api'
import type { ShotRef } from '@/lib/shot-bulk'

/**
 * まとめて解像度を上げる前の下見を、人が読める文にする（ADR-0044）。
 *
 * 掛かる時間は出さない。**生成先は積んだあとにしか見込みを返さない**ので、
 * 押す前に言える数字が無い（積んだあとの「あと何分」は Take ごとに出る）。
 * 飛ばす Shot は**コードと理由**で並べる（件数に畳まない。L-015）。
 */

export type UpscalePlan = {
  readonly targetCount: number
  /** 飛ばす Shot。`コード — 理由`。 */
  readonly skipped: readonly string[]
}

const codeOf = (shots: readonly ShotRef[], shotId: string): string =>
  shots.find((shot) => shot.id === shotId)?.code ?? shotId

export const planFromUpscaleResult = (
  result: WireBulkUpscaleResult,
  shots: readonly ShotRef[],
): UpscalePlan => ({
  targetCount: result.results.filter((entry) => entry.ok).length,
  skipped: result.results.flatMap((entry) =>
    entry.ok ? [] : [`${codeOf(shots, entry.shotId)} — ${entry.reason}`],
  ),
})

export const describeUpscalePlan = (plan: UpscalePlan): string =>
  plan.targetCount === 0
    ? '解像度を上げられる Shot がありません。'
    : `採用中の Take ${String(plan.targetCount)} 本の解像度を上げます。1 本ずつ順番に上げ、ほかの生成が動いていればその後になります。`
