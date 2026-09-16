import { z } from 'zod'
import type { ProjectId, ShotId } from '../common/ids.js'

/**
 * 生成コストの上限。**実 Provider を使う前に必ず有効にすること。**
 *
 * スタブはコスト 0 なので Phase 1 では発動しないが、
 * fal.ai / BytePlus に切り替えた瞬間に暴走が現実の課金になる。
 * 再生成ループ（ARCHITECTURE.md §13）と併せて二重に止める。
 */
export const CostLimits = z
  .object({
    /** プロジェクト全体の予算。null は無制限（本番では設定すること）。 */
    projectBudgetUsd: z.number().positive().nullable(),
    /** Shot 1 つに使える累積上限。再生成を重ねたときの歯止め。 */
    maxCostPerShotUsd: z.number().positive(),
    /** 1 回の生成要求で使える上限。count を掛けた合計で判定する。 */
    maxCostPerRequestUsd: z.number().positive(),
  })
  .refine((l) => l.maxCostPerRequestUsd <= l.maxCostPerShotUsd, {
    message:
      '1 回の要求の上限は Shot の累積上限以下でなければなりません。' +
      '大きいと要求上限が一度も発動せず、設定したつもりで効いていない状態になります。',
    path: ['maxCostPerRequestUsd'],
  })
  .refine((l) => l.projectBudgetUsd === null || l.maxCostPerShotUsd <= l.projectBudgetUsd, {
    message: 'Shot の上限はプロジェクト予算以下でなければなりません。',
    path: ['maxCostPerShotUsd'],
  })
export type CostLimits = z.infer<typeof CostLimits>

/**
 * 既定値は iXA CUP MV の実測見積りから決めている（ARCHITECTURE.md §24 R3）。
 *
 * Seedance 720p は約 $0.303/秒。5 秒の Take が約 $1.5。
 * - 1 要求（count=4）で約 $6 → maxCostPerRequestUsd = 6
 * - 1 Shot で 4 Take 分まで → maxCostPerShotUsd = 6
 * - MV 全体は約 40 Shot × 3 Take で約 $180 → 予算はプロジェクト作成時に明示的に設定する
 *
 * **要求上限は Shot 上限以下**にすること。大きいと一度も発動しない。
 */
export const DEFAULT_COST_LIMITS: CostLimits = Object.freeze({
  projectBudgetUsd: null,
  maxCostPerShotUsd: 6,
  maxCostPerRequestUsd: 6,
})

export type CostState = {
  readonly projectSpentUsd: number
  readonly shotSpentUsd: number
}

export type CostDecision =
  | { readonly allowed: true; readonly estimatedUsd: number }
  | {
      readonly allowed: false
      readonly estimatedUsd: number
      readonly reason: string
      /** どの上限に当たったか。UI がどれを緩めればよいか示せるようにする。 */
      readonly limit: 'project_budget' | 'shot' | 'request'
    }

/**
 * 生成を始めてよいかを判定する。**キューへ投入する前に必ず通すこと。**
 *
 * 判定は純粋関数にしてある。Worker 側ではなく API 側で止めるのは、
 * 「投入してから失敗する」より「投入しない」方が利用者に分かりやすいため。
 */
export const checkCostLimits = (
  limits: CostLimits,
  state: CostState,
  estimatedUsd: number,
): CostDecision => {
  const fmt = (n: number): string => `$${n.toFixed(3)}`

  if (estimatedUsd > limits.maxCostPerRequestUsd) {
    return {
      allowed: false,
      estimatedUsd,
      limit: 'request',
      reason: `1 回の要求の上限 ${fmt(limits.maxCostPerRequestUsd)} を超えます（見積り ${fmt(estimatedUsd)}）`,
    }
  }

  if (state.shotSpentUsd + estimatedUsd > limits.maxCostPerShotUsd) {
    return {
      allowed: false,
      estimatedUsd,
      limit: 'shot',
      reason:
        `この Shot の上限 ${fmt(limits.maxCostPerShotUsd)} を超えます` +
        `（使用済み ${fmt(state.shotSpentUsd)} + 見積り ${fmt(estimatedUsd)}）`,
    }
  }

  if (
    limits.projectBudgetUsd !== null &&
    state.projectSpentUsd + estimatedUsd > limits.projectBudgetUsd
  ) {
    return {
      allowed: false,
      estimatedUsd,
      limit: 'project_budget',
      reason:
        `プロジェクトの予算 ${fmt(limits.projectBudgetUsd)} を超えます` +
        `（使用済み ${fmt(state.projectSpentUsd)} + 見積り ${fmt(estimatedUsd)}）`,
    }
  }

  return { allowed: true, estimatedUsd }
}

export type CostSummary = {
  readonly projectId: ProjectId
  readonly totalUsd: number
  readonly byShot: ReadonlyMap<ShotId, number>
}

/** Take の実測コストを集計する。見積りではなく実際に払った額。 */
export const summarizeCost = (
  projectId: ProjectId,
  takes: readonly { shotId: ShotId; costUsd: number }[],
): CostSummary => {
  const byShot = new Map<ShotId, number>()
  let totalUsd = 0
  for (const take of takes) {
    byShot.set(take.shotId, (byShot.get(take.shotId) ?? 0) + take.costUsd)
    totalUsd += take.costUsd
  }
  return { projectId, totalUsd, byShot }
}
