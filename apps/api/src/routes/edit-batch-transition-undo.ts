import { DbNotFoundError, type TransitionRepository } from '@ixa/db'
import type { EditBatchTransitionEdit, ProjectId, TransitionId } from '@ixa/domain'

/**
 * トランジションの記録（`transition_edit`）を戻す。**消したものは同じ ID・同じ中身で置き直す。**
 * 置いたものは消す。戻せなかったものは理由を返す（握り潰さない。1 件の失敗で残りを止めもしない）。
 */

export type TransitionUndoDeps = {
  readonly transitions?: Pick<TransitionRepository, 'findByProject' | 'create' | 'delete'>
}

export const TRANSITION_UNAVAILABLE_REASON = 'トランジションを戻す口がありません'
export const TRANSITION_ALREADY_REMOVED_REASON = 'トランジションは既に消されています'
export const TRANSITION_PAIR_TAKEN_REASON = '同じ 2 つの Shot の間に、別のトランジションが置かれています'

const undoOne = async (
  transitions: NonNullable<TransitionUndoDeps['transitions']>,
  projectId: ProjectId,
  edit: EditBatchTransitionEdit,
): Promise<string | null> => {
  if (edit.op === 'create') {
    try {
      await transitions.delete(edit.transitionId)
      return null
    } catch (cause) {
      if (cause instanceof DbNotFoundError) return TRANSITION_ALREADY_REMOVED_REASON
      throw cause
    }
  }
  // 置き直す前に、同じ組・同じ出入りが空いているかを見る（2 つの Shot の間に 1 本・出入りは 1 本ずつ）。
  const existing = await transitions.findByProject(projectId)
  const { before } = edit
  const taken = existing.some(
    (t) => t.id === edit.transitionId || t.fromShotId === before.fromShotId || t.toShotId === before.toShotId,
  )
  if (taken) return TRANSITION_PAIR_TAKEN_REASON
  await transitions.create({ ...before, projectId, id: edit.transitionId })
  return null
}

/** **後の操作から先に戻す**（差し替えは「新しい方を消す → 前の方を置き直す」の順になる）。 */
export const undoTransitionEdits = async (
  deps: TransitionUndoDeps,
  projectId: ProjectId,
  edits: readonly EditBatchTransitionEdit[],
): Promise<{
  readonly restored: readonly TransitionId[]
  readonly failed: readonly { readonly transitionId: TransitionId; readonly reason: string }[]
}> => {
  const restored: TransitionId[] = []
  const failed: { transitionId: TransitionId; reason: string }[] = []
  for (const edit of [...edits].reverse()) {
    if (deps.transitions === undefined) {
      failed.push({ transitionId: edit.transitionId, reason: TRANSITION_UNAVAILABLE_REASON })
      continue
    }
    try {
      const reason = await undoOne(deps.transitions, projectId, edit)
      if (reason === null) restored.push(edit.transitionId)
      else failed.push({ transitionId: edit.transitionId, reason })
    } catch (cause) {
      failed.push({ transitionId: edit.transitionId, reason: `戻せませんでした: ${cause instanceof Error ? cause.message : String(cause)}` })
    }
  }
  return { restored: [...restored].reverse(), failed: [...failed].reverse() }
}
