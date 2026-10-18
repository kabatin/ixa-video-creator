import { DbNotFoundError, type TimelineClipRepository } from '@ixa/db'
import type { EditBatchClipEdit, TimelineClipId } from '@ixa/domain'

/**
 * クリップ 1 件ずつの記録（`clip_edit`）を戻す。**戻すと同じ ID・同じ中身。**
 *
 * - 作った物 → 論理削除する
 * - 直した物 → 控えの値で上書きする。**その後に消されていたら生き返らせない**（人が後で消した判断を覆さない）
 * - 消した物 → 論理削除を外す（中身は消したときのまま）
 *
 * 戻せなかったものは理由を返す（握り潰さない。1 件の失敗で残りを止めもしない）。
 */

export type ClipEditUndoDeps = {
  readonly timelineClips: Pick<TimelineClipRepository, 'findById' | 'update' | 'softDelete' | 'restore'>
}

export const CLIP_ALREADY_REMOVED_REASON = 'クリップは既に消されています'
export const CLIP_GONE_REASON = 'クリップが見つかりません（消された可能性があります）'
export const CLIP_NOT_REMOVED_REASON = 'クリップは既に戻っているか、見つかりません'

const undoOne = async (deps: ClipEditUndoDeps, edit: EditBatchClipEdit): Promise<string | null> => {
  if (edit.op === 'create') {
    try {
      await deps.timelineClips.softDelete(edit.clipId)
      return null
    } catch (cause) {
      if (cause instanceof DbNotFoundError) return CLIP_ALREADY_REMOVED_REASON
      throw cause
    }
  }
  if (edit.op === 'update') {
    if ((await deps.timelineClips.findById(edit.clipId)) === null) return CLIP_GONE_REASON
    await deps.timelineClips.update(edit.clipId, edit.before)
    return null
  }
  return (await deps.timelineClips.restore(edit.clipId)) === null ? CLIP_NOT_REMOVED_REASON : null
}

/** **後の操作から先に戻す**（同じクリップを 2 度触った記録でも、いちばん前の形に落ち着く）。 */
export const undoClipEdits = async (
  deps: ClipEditUndoDeps,
  edits: readonly EditBatchClipEdit[],
): Promise<{
  readonly restored: readonly TimelineClipId[]
  readonly failed: readonly { readonly clipId: TimelineClipId; readonly reason: string }[]
}> => {
  const restored: TimelineClipId[] = []
  const failed: { clipId: TimelineClipId; reason: string }[] = []
  for (const edit of [...edits].reverse()) {
    try {
      const reason = await undoOne(deps, edit)
      if (reason === null) restored.push(edit.clipId)
      else failed.push({ clipId: edit.clipId, reason })
    } catch (cause) {
      failed.push({ clipId: edit.clipId, reason: `戻せませんでした: ${cause instanceof Error ? cause.message : String(cause)}` })
    }
  }
  // 返す順は記録の順に揃える（画面が並べる順と、人が操作した順を合わせる）。
  return { restored: [...restored].reverse(), failed: [...failed].reverse() }
}
