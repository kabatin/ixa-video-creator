import {
  checkCostLimits,
  type CostLimits,
  type GenerationJobId,
  type ModelId,
  type ProjectId,
  type Shot,
  type ShotId,
  type TakeId,
} from '@ixa/domain'
import type { CompiledGeneration } from '@ixa/generation'
import type { VideoModelDescriptor } from '@ixa/provider-core'
import {
  enqueueJobs,
  fitTimingWhenStretched,
  publishShotStatus,
  type ShotRoutesDeps,
} from './shots.js'

/**
 * 一括で投入するときの共通の段取り（ADR-0042 で「まとめて本番で作り直す」が 2 つ目の
 * 入り口になった）。
 *
 * **一括生成と本番のまとめ投入が、同じ関数を通る。** 片方にだけ予算の判定を書くと、
 * もう片方は上限を素通りして課金される。金額に効く規則は書き写さない（L-016）。
 *
 * どちらも流れは同じで、違うのは「1 件ずつ何を組むか」だけ。
 *   1. 全件を見積もる（ここでは 1 件も投入しない）
 *   2. 合計がプロジェクト予算を超えるなら **1 件も投入しない**
 *   3. 投入する
 */

export const SHOT_NOT_FOUND_REASON = 'Shot が見つかりません'
export const FOREIGN_SHOT_REASON = 'この Project の Shot ではありません'

/** 対象として使える Shot か。使えないなら理由を返し、**その 1 件だけ**落とす。 */
export type ResolvedShot = { readonly shot: Shot } | { readonly reason: string }

export const resolveShot = async (
  deps: Pick<ShotRoutesDeps, 'shots'>,
  projectId: ProjectId,
  shotId: ShotId,
): Promise<ResolvedShot> => {
  const shot = await deps.shots.findById(shotId)
  if (shot === null) return { reason: SHOT_NOT_FOUND_REASON }
  if (shot.projectId !== projectId) return { reason: FOREIGN_SHOT_REASON }
  return { shot }
}

/** 422 の本文（`fail` に渡す形）。合計と上限を必ず添える。 */
export type BudgetRejection = {
  readonly reason: string
  readonly fields: Record<string, string[]>
}

/**
 * **プロジェクト予算だけは合計で見る。** 超えたら 1 件も投入しない（`null` なら投入してよい）。
 *
 * 要求上限と Shot 上限は呼ぶ側が **1 件ずつ**当て済みなので、ここでは無限大に差し替えて
 * 予算の枝だけ通す。**規則は写さず、同じ `checkCostLimits` を別の上限で呼ぶ。**
 * 差し替えた値は `CostLimits` の不変条件（Shot 上限 ≤ 予算）に反するのでスキーマでは作れない。
 */
export const budgetRejection = (
  limits: CostLimits,
  projectSpentUsd: number,
  estimatedTotalUsd: number,
  plannedCount: number,
): BudgetRejection | null => {
  if (plannedCount === 0) return null
  const budgetOnly: CostLimits = {
    ...limits,
    maxCostPerRequestUsd: Number.POSITIVE_INFINITY,
    maxCostPerShotUsd: Number.POSITIVE_INFINITY,
  }
  const decision = checkCostLimits(budgetOnly, { projectSpentUsd, shotSpentUsd: 0 }, estimatedTotalUsd)
  if (decision.allowed) return null
  // 差し替えにより当たりうるのは予算だけ。上限額はその予算を返す。
  const limitUsd = limits.projectBudgetUsd
  return {
    reason: decision.reason,
    fields: {
      cost: [decision.limit],
      estimatedTotalUsd: [estimatedTotalUsd.toFixed(3)],
      limitUsd: [limitUsd === null ? '無制限' : limitUsd.toFixed(3)],
    },
  }
}

/** 投入が決まった 1 件。**Shot ごとにモデルも系譜も違ってよい。** */
export type PlannedEnqueue = {
  readonly shot: Shot
  readonly compiled: CompiledGeneration<VideoModelDescriptor>
  /** 利用者が指定したモデル（`AUTO` は記録のためそのまま残す）。 */
  readonly requestedModel: ModelId | 'AUTO'
  readonly count: number
  /**
   * 作り直しの系譜（ADR-0042）。**行に積む。**
   * Take は作る瞬間にしか親を持てないので、ここで落とすと永久に系譜を持たない。
   */
  readonly lineage?: { readonly parentTakeId: TakeId; readonly regenerationReason: string } | null
}

/**
 * 投入する。Shot ごとに作ったジョブの ID を返す。
 *
 * 投入した Shot ごとに出来事を流す。1 通にまとめると、どの Shot が動いたか画面に出せない。
 */
export const enqueuePlanned = async (
  deps: Pick<ShotRoutesDeps, 'shots' | 'generationJobs' | 'queue' | 'events' | 'logger'>,
  entries: readonly PlannedEnqueue[],
): Promise<Map<ShotId, GenerationJobId[]>> => {
  const jobIdsByShot = new Map<ShotId, GenerationJobId[]>()
  for (const entry of entries) {
    await fitTimingWhenStretched(deps, entry.shot, entry.compiled)
    jobIdsByShot.set(
      entry.shot.id,
      await enqueueJobs(
        deps,
        entry.shot,
        entry.compiled,
        entry.requestedModel,
        entry.count,
        [],
        entry.lineage ?? null,
      ),
    )
    const generating = await deps.shots.updateStatus(entry.shot.id, 'generating')
    await publishShotStatus(deps, generating)
  }
  return jobIdsByShot
}
