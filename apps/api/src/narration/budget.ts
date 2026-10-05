import { checkCostLimits, type CostDecision, type Project } from '@ixa/domain'
import { costLimitsFor } from '../routes/shots.js'
import type { NarrationDeps } from './deps.js'

/**
 * 声・文字起こしを頼む前に予算を確かめる（ADR-0038）。使った額は動画の Take と声・文字起こしを足して見る。
 * `lineSpentUsd` は 1 行で使った額（Shot の上限と同じ考え方で、1 行に掛けすぎない）。
 */
export const budgetProblem = async (
  deps: Pick<NarrationDeps, 'spentByProject'>,
  project: Project,
  lineSpentUsd: number,
  estimateUsd: number,
): Promise<Extract<CostDecision, { allowed: false }> | null> => {
  const decision = checkCostLimits(
    costLimitsFor(project),
    { projectSpentUsd: await deps.spentByProject(project.id), shotSpentUsd: lineSpentUsd },
    estimateUsd,
  )
  return decision.allowed ? null : decision
}
