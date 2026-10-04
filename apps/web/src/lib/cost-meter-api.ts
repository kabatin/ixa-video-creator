import { ShotId, type ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 費用メーターの呼び出し口（P63-2）。
 *
 * ```
 * GET /projects/{projectId}/cost   使った額を出どころ（実測 / スタブ）で割って返す
 * ```
 *
 * **額だけを取ってこない。** 件数が無いと「実 Provider を一度も回していない」ことが消える。
 */

export const WireCostBucket = z.object({
  takeCount: z.number().int().nonnegative(),
  totalUsd: z.number().nonnegative(),
})
export type WireCostBucket = z.infer<typeof WireCostBucket>

/**
 * 実測として数えた Provider 1 つ分。
 * **名前を受け取る。** スタブの一覧に載せ忘れた Provider は額 0 のまま実測に化けるので、
 * 額では気付けない。名前でだけ気付ける。
 */
export const WireProviderCost = z.object({
  providerId: z.string().min(1),
  takeCount: z.number().int().nonnegative(),
  totalUsd: z.number().nonnegative(),
})
export type WireProviderCost = z.infer<typeof WireProviderCost>

export const WireMeasuredBucket = WireCostBucket.extend({
  byProvider: z.array(WireProviderCost),
})
export type WireMeasuredBucket = z.infer<typeof WireMeasuredBucket>

/** `byShot` に行として出せなかった分（消えた Shot）。合計には入っている。 */
export const WireUnlistedShotCost = z.object({
  takeCount: z.number().int().nonnegative(),
  measuredUsd: z.number().nonnegative(),
  /** **件数**。額ではない（`WireShotCost.stubTakeCount` と単位を揃える）。 */
  stubTakeCount: z.number().int().nonnegative(),
})
export type WireUnlistedShotCost = z.infer<typeof WireUnlistedShotCost>

/** **額と件数を名前で区別する。** スタブの額は常に 0 なので件数で受け取る。 */
export const WireShotCost = z.object({
  shotId: ShotId,
  measuredUsd: z.number().nonnegative(),
  stubTakeCount: z.number().int().nonnegative(),
})
export type WireShotCost = z.infer<typeof WireShotCost>

/** `budgetUsd` の null は「未設定」。0 に畳まない（lessons L-021）。 */
export const WireOtherRunCost = z.object({
  kind: z.string().min(1),
  runCount: z.number().int().positive(),
  totalUsd: z.number().nonnegative(),
})
export type WireOtherRunCost = z.infer<typeof WireOtherRunCost>

export const WireCostMeter = z.object({
  budgetUsd: z.number().nonnegative().nullable(),
  measured: WireMeasuredBucket,
  stub: WireCostBucket,
  /** 生きている Shot だけの内訳。合計と一致しないことがある。 */
  byShot: z.array(WireShotCost),
  /** 内訳と合計の差の説明。 */
  unlistedShots: WireUnlistedShotCost,
  /** Take 以外で払った額（絵コンテ下書き・レビュー）。0 件の種類は並ばない。 */
  otherRuns: z.array(WireOtherRunCost),
  /** 作品の複製で写した Take（件数と、元の作品で払った額）。この作品の費用・予算には入らない。 */
  copied: WireCostBucket,
  /** **予算と突き合わせるのはこの額。** 実測の Take と otherRuns の合計。 */
  totalUsd: z.number().nonnegative(),
})
export type WireCostMeter = z.infer<typeof WireCostMeter>

export type CostMeterApi = {
  getCostMeter: (projectId: ProjectId) => Promise<WireCostMeter>
}

export const createCostMeterApi = (requester: Requester): CostMeterApi => ({
  getCostMeter: async (projectId) =>
    requester.get(`/projects/${encodeURIComponent(projectId)}/cost`, WireCostMeter),
})
