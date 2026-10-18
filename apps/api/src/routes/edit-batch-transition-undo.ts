import { DbNotFoundError, type ShotRepository, type TransitionRepository } from '@ixa/db'
import type { EditBatchTransitionEdit, ProjectId, TransitionId } from '@ixa/domain'
import { checkPlacement } from './transitions.js'

/**
 * トランジションの記録（`transition_edit`）を戻す。**消したものは同じ ID・同じ中身で置き直す。**
 * 置いたものは消す。戻せなかったものは理由を返す（握り潰さない。1 件の失敗で残りを止めもしない）。
 * **置き直しも置く口と同じ検査を通す**（尺が Shot を超えない・出入りが空いている・同じ作品の Shot）。
 * 消した後で Shot の尺が縮んだ・別のトランジションが置かれた、なら置き直さずに理由を返す。
 */

export type TransitionUndoDeps = {
  readonly transitions?: Pick<TransitionRepository, 'findByProject' | 'create' | 'delete'>
  readonly shots: Pick<ShotRepository, 'findById'>
}

export const TRANSITION_UNAVAILABLE_REASON = 'トランジションを戻す口がありません'
export const TRANSITION_ALREADY_REMOVED_REASON = 'トランジションは既に消されています'
export const TRANSITION_PAIR_TAKEN_REASON = '同じ 2 つの Shot の間に、別のトランジションが置かれています'

const placementReason = (fields: Readonly<Record<string, readonly string[]>>): string =>
  `置き直せませんでした: ${Object.values(fields).flat().join(' / ')}`

const undoOne = async (
  transitions: NonNullable<TransitionUndoDeps['transitions']>,
  shots: TransitionUndoDeps['shots'],
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
  const existing = await transitions.findByProject(projectId)
  if (existing.some((t) => t.id === edit.transitionId)) return TRANSITION_PAIR_TAKEN_REASON
  const placement = await checkPlacement({ shots }, projectId, edit.before, existing)
  if (!placement.ok) return placementReason(placement.fields)
  await transitions.create({ ...edit.before, projectId, durationSec: placement.durationSec, id: edit.transitionId })
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
      const reason = await undoOne(deps.transitions, deps.shots, projectId, edit)
      if (reason === null) restored.push(edit.transitionId)
      else failed.push({ transitionId: edit.transitionId, reason })
    } catch (cause) {
      failed.push({ transitionId: edit.transitionId, reason: `戻せませんでした: ${cause instanceof Error ? cause.message : String(cause)}` })
    }
  }
  return { restored: [...restored].reverse(), failed: [...failed].reverse() }
}
