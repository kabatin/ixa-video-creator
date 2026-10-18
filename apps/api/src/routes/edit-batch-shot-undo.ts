import { DbNotFoundError, type ShotRepository, type TakeRepository } from '@ixa/db'
import type { EditBatchShotEdit, ShotId } from '@ixa/domain'

/**
 * Shot の作成・削除の記録（`shotEdits`）を戻す。**消した Shot は同じ ID・同じ中身で論理削除を外し**、作った Shot は論理削除する。
 * 戻せなかったものは理由を返す（握り潰さない。1 件の失敗で残りを止めもしない）。
 *
 * **作った Shot でも、Take ができた・生成中・ロック中なら消さない**（分割・結合の「Take が無い Shot だけ」と同じ規則。
 * 黙って消すと、払って作った Take や人が止めた Shot が消える）。
 */

export type ShotEditUndoDeps = {
  readonly shots: Pick<ShotRepository, 'findById' | 'softDelete' | 'restore'>
  /** 作った Shot に Take ができたかを見る。繋いでいない環境では、確かめられないので作成を戻さない。 */
  readonly takes?: Pick<TakeRepository, 'findByShot'>
}

export const SHOT_ALREADY_REMOVED_REASON = 'Shot は既に消されています'
export const SHOT_NOT_REMOVED_REASON = 'Shot は既に戻っているか、見つかりません'
export const SHOT_HAS_TAKE_REASON = 'Take があるので消しません（Take の無い Shot だけ作成を戻せます）'
export const SHOT_GENERATING_REASON = '生成中なので消しません'
export const SHOT_LOCKED_REASON = 'ロック中なので消しません'
export const SHOT_TAKES_UNKNOWN_REASON = 'Take があるか確かめられないので消しません'

/** 作った Shot を消してよいか。だめなら理由。 */
const createdShotBlocker = async (deps: ShotEditUndoDeps, shotId: ShotId): Promise<string | null> => {
  const shot = await deps.shots.findById(shotId)
  if (shot === null) return SHOT_ALREADY_REMOVED_REASON
  if (shot.lockedAt !== null) return SHOT_LOCKED_REASON
  if (shot.status === 'generating') return SHOT_GENERATING_REASON
  if (deps.takes === undefined) return SHOT_TAKES_UNKNOWN_REASON
  return (await deps.takes.findByShot(shotId)).length > 0 ? SHOT_HAS_TAKE_REASON : null
}

const undoOne = async (deps: ShotEditUndoDeps, edit: EditBatchShotEdit): Promise<string | null> => {
  if (edit.op === 'create') {
    const blocker = await createdShotBlocker(deps, edit.shotId)
    if (blocker !== null) return blocker
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
