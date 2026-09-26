import type { ProjectId, ShotId } from '@ixa/domain'
import { z } from 'zod'
import { WireShot } from '@/lib/api-schemas'
import type { Requester } from '@/lib/requester'

/**
 * Shot の分割と結合（ADR-0024）の呼び出し口。規則は `@ixa/domain` の `planSplit` / `planMerge`。
 * 画面はそれで押せるかを決め、実行の可否は API が Take の件数まで見て最終的に決める。
 */

export const WireSplitResult = z.object({ first: WireShot, second: WireShot })
export type WireSplitResult = z.infer<typeof WireSplitResult>

export const WireMergeResult = z.object({ shot: WireShot, removedShotIds: z.array(z.string()) })
export type WireMergeResult = z.infer<typeof WireMergeResult>

export type ShotEditApi = {
  /** `atSec`（タイムライン上の秒）で前後に割る。後半は `CUT-02B` のように元が分かるコードになる。 */
  splitShot: (shotId: ShotId, atSec: number) => Promise<WireSplitResult>
  /** 隣り合う Shot を先頭にまとめる。先頭以外は消える（取り消しは無い）。 */
  mergeShots: (projectId: ProjectId, shotIds: readonly ShotId[]) => Promise<WireMergeResult>
}

export const createShotEditApi = (requester: Requester): ShotEditApi => ({
  splitShot: async (shotId, atSec) =>
    requester.post(`/shots/${encodeURIComponent(shotId)}/split`, { atSec }, WireSplitResult),
  mergeShots: async (projectId, shotIds) =>
    requester.post(
      `/projects/${encodeURIComponent(projectId)}/shots/merge`,
      { shotIds: [...shotIds] },
      WireMergeResult,
    ),
})
