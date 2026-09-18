import {
  EditBatchId,
  EditBatchKind,
  ShotId,
  type EditBatchId as EditBatchIdType,
  type ProjectId,
} from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 一括で変えた操作の履歴と取り消しの呼び出し口（P64-1）。
 *
 * ```
 * GET  /projects/{projectId}/edit-batches            履歴（直近が先頭）
 * POST /projects/{projectId}/edit-batches/{id}/undo  取り消す
 * ```
 *
 * **取り消せるかどうかの判定はサーバが持つ。** 画面は `canUndo` を見るだけで、
 * 「取り消し済みか」「中身が空か」を自分で組み立て直さない（lessons L-016）。
 *
 * 日時は ISO 文字列で運ぶ。`Date` をそのまま JSON に載せると、
 * 受け手ごとに解釈がぶれる。
 */

export const WireEditBatch = z.object({
  id: EditBatchId,
  kind: EditBatchKind,
  /** 人が読む見出し。「粗編集を 49 件の Shot へ適用しました」など。 */
  summary: z.string().min(1),
  /** 変える前を記録した Shot の件数。 */
  shotCount: z.number().int().nonnegative(),
  /** **`null` は「まだ取り消していない」**（「取り消せない」ではない）。 */
  undoneAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  canUndo: z.boolean(),
})
export type WireEditBatch = z.infer<typeof WireEditBatch>

export const WireEditBatchList = z.array(WireEditBatch)

/** **戻せた分と戻せなかった分の両方。** 件数だけでは何が残ったか分からない。 */
export const WireUndoResult = z.object({
  batch: WireEditBatch,
  restored: z.array(ShotId),
  failed: z.array(z.object({ shotId: ShotId, reason: z.string().min(1) })),
})
export type WireUndoResult = z.infer<typeof WireUndoResult>

export type EditHistoryApi = {
  readonly listEditBatches: (projectId: ProjectId) => Promise<WireEditBatch[]>
  readonly undoEditBatch: (
    projectId: ProjectId,
    id: EditBatchIdType,
  ) => Promise<WireUndoResult>
}

const basePath = (projectId: ProjectId): string =>
  `/projects/${encodeURIComponent(projectId)}/edit-batches`

export const createEditHistoryApi = (requester: Requester): EditHistoryApi => ({
  listEditBatches: async (projectId) => requester.get(basePath(projectId), WireEditBatchList),

  undoEditBatch: async (projectId, id) =>
    requester.post(`${basePath(projectId)}/${encodeURIComponent(id)}/undo`, undefined, WireUndoResult),
})
