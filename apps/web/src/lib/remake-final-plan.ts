import { formatApproxDuration } from '@/lib/format-time'
import type { WireBulkRemakeFinalResult } from '@/lib/shot-bulk-api'
import type { ShotRef } from '@/lib/shot-bulk'

/**
 * 押す前の下見を、人が読める 1 文にする（ADR-0042 段 4 / 資料 3.4）。
 *
 * **本数・掛かる時間・終わる時刻の 3 つを先に言う。** 一晩かけて流す操作なので、
 * 押したあとに「何時に終わるのか」を聞かれても遅い。
 * 飛ばす Shot は**コードと理由**で並べる（件数に畳まない。L-015）。
 */

export type RemakeFinalPlan = {
  readonly targetCount: number
  readonly totalLatencySec: number
  /** 飛ばす Shot。`コード — 理由`。 */
  readonly skipped: readonly string[]
  readonly estimatedTotalUsd: number
}

const codeOf = (shots: readonly ShotRef[], shotId: string): string =>
  shots.find((shot) => shot.id === shotId)?.code ?? shotId

export const planFromRemakeResult = (
  result: WireBulkRemakeFinalResult,
  shots: readonly ShotRef[],
): RemakeFinalPlan => ({
  targetCount: result.results.filter((entry) => entry.ok).length,
  totalLatencySec: result.estimatedTotalLatencySec,
  skipped: result.results.flatMap((entry) =>
    entry.ok ? [] : [`${codeOf(shots, entry.shotId)} — ${entry.reason}`],
  ),
  estimatedTotalUsd: result.estimatedTotalUsd,
})

/** `23:40`。**日付は出さない**（日をまたぐときだけ「翌日」を添える）。 */
const clockOf = (at: Date, from: Date): string => {
  const time = `${String(at.getHours())}:${String(at.getMinutes()).padStart(2, '0')}`
  return at.getDate() === from.getDate() ? time : `翌 ${time}`
}

/**
 * 「8 本を本番で作り直します。見込み 約 1 時間 20 分（終わり 23:40 頃）。」
 *
 * **0 本のときは時刻を出さない。** 終わる時刻が「いま」になって意味を持たない。
 * 時間は worker が順番に 1 本ずつ作る前提の足し算で、**ほかの生成が走っていれば更に後**になる。
 */
export const describeRemakePlan = (plan: RemakeFinalPlan, now: Date): string => {
  if (plan.targetCount === 0) return '本番で作り直せる Shot がありません。'
  const finishesAt = new Date(now.getTime() + plan.totalLatencySec * 1000)
  return [
    `${String(plan.targetCount)} 本を本番で作り直します。`,
    `見込み ${formatApproxDuration(plan.totalLatencySec)}`,
    `（終わり ${clockOf(finishesAt, now)} 頃）。`,
    'ほかの生成が動いていれば、その後になります。',
  ].join('')
}
