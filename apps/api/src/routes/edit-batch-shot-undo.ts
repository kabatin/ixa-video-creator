import { DbNotFoundError, type ShotRepository } from '@ixa/db'
import type { EditBatchShotEdit, ShotId } from '@ixa/domain'

/**
 * Shot の作成・削除の記録（`shotEdits`）を戻す。**消した Shot は同じ ID・同じ中身で論理削除を外し**、作った Shot は論理削除する。
 * 戻せなかったものは理由を返す（握り潰さない。1 件の失敗で残りを止めもしない）。
 */

export type ShotEditUndoDeps = {
  readonly shots: Pick<ShotRepository, 'softDelete' | 'restore'>
}

export const SHOT_ALREADY_REMOVED_REASON = 'Shot は既に消されています'
export const SHOT_NOT_REMOVED_REASON = 'Shot は既に戻っているか、見つかりません'

const undoOne = async (deps: ShotEditUndoDeps, edit: EditBatchShotEdit): Promise<string | null> => {
  if (edit.op === 'create') {
    try {
      await deps.shots.softDelete(edit.shotId)
      return null
    } catch (cause) {
      if (cause instanceof DbNotFoundError) return SHOT_ALREADY_REMOVED_REASON
      throw cause
    }
  }
  return (await deps.shots.restore(edit.shotId)) === null ? SHOT_NOT_REMOVED_REASON : null
}

/** **後の操作から先に戻す**。 */
export const undoShotEdits = async (
  deps: ShotEditUndoDeps,
  edits: readonly EditBatchShotEdit[],
): Promise<{
  readonly restored: readonly ShotId[]
  readonly failed: readonly { readonly shotId: ShotId; readonly reason: string }[]
}> => {
  const restored: ShotId[] = []
  const failed: { shotId: ShotId; reason: string }[] = []
  for (const edit of [...edits].reverse()) {
    try {
      const reason = await undoOne(deps, edit)
      if (reason === null) restored.push(edit.shotId)
      else failed.push({ shotId: edit.shotId, reason })
    } catch (cause) {
      // 同じコードの Shot が後から作られていると、一意制約で戻せない。
      failed.push({ shotId: edit.shotId, reason: `戻せませんでした: ${cause instanceof Error ? cause.message : String(cause)}` })
    }
  }
  return { restored: [...restored].reverse(), failed: [...failed].reverse() }
}
