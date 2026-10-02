import type { ProjectId } from '@ixa/domain'
import { RoughCutChange, RoughCutUnresolved } from '@ixa/timeline'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 粗編集の呼び出し口（P63-3）。
 *
 * ```
 * POST /projects/{projectId}/timeline/rough-cut/plan    案を計算する。**何も書かない**
 * POST /projects/{projectId}/timeline/rough-cut/apply   案を本文で送って適用する
 * ```
 *
 * **案の形は `@ixa/timeline` のものをそのまま使う。** 画面側で同じ形を書き写すと、
 * 片方だけが増えた日にズレる（lessons L-016）。ここが持つのは経路だけ。
 *
 * **apply には、画面が受け取った案をそのまま送り返す。** 送り直す値を画面で作ると、
 * 人が見た案と当たる内容が別物になりうる。
 */

export const WireRoughCutPlan = z.object({
  changes: z.array(RoughCutChange),
  /** 機械が決められなかったもの。**必ず理由が付いている。** */
  unresolved: z.array(RoughCutUnresolved),
})
export type WireRoughCutPlan = z.infer<typeof WireRoughCutPlan>

export const WireRoughCutSkipped = z.object({
  change: RoughCutChange,
  reason: z.string().min(1),
})
export type WireRoughCutSkipped = z.infer<typeof WireRoughCutSkipped>

/** **当てた分と当てなかった分の両方**。件数だけでは何が残ったか分からない。 */
export const WireRoughCutApplyResult = z.object({
  applied: z.array(RoughCutChange),
  skipped: z.array(WireRoughCutSkipped),
})
export type WireRoughCutApplyResult = z.infer<typeof WireRoughCutApplyResult>

export type RoughCutApi = {
  readonly planRoughCut: (projectId: ProjectId) => Promise<WireRoughCutPlan>
  readonly applyRoughCut: (
    projectId: ProjectId,
    changes: readonly RoughCutChange[],
    /** 変更の履歴の見出し（任意）。無ければ「粗編集を N 件の Shot へ適用しました」。 */
    summary?: string,
  ) => Promise<WireRoughCutApplyResult>
}

const basePath = (projectId: ProjectId): string =>
  `/projects/${encodeURIComponent(projectId)}/timeline/rough-cut`

export const createRoughCutApi = (requester: Requester): RoughCutApi => ({
  planRoughCut: async (projectId) =>
    requester.post(`${basePath(projectId)}/plan`, undefined, WireRoughCutPlan),

  applyRoughCut: async (projectId, changes, summary) =>
    requester.post(
      `${basePath(projectId)}/apply`,
      summary === undefined ? { changes } : { changes, summary },
      WireRoughCutApplyResult,
    ),
})
