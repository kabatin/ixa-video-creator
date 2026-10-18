import { z } from 'zod'
import { TransitionId } from '../common/ids.js'
import { Transition } from './shot.js'

/**
 * トランジション 1 本ずつの置く・消すの記録（`transition_edit`。2026-10-19）。差し替えは「消す + 置く」を 1 つの記録にする。
 *
 * **消した物は丸ごとの控えを持ち、戻すと同じ ID・同じ中身で置き直す。** トランジションは物理削除で、
 * ほかから ID で指されることも無いので、論理削除の列を足さずに同じ ID で作り直せば足りる。
 */

/** 控え。ID と作品は記録の側が持つ。 */
export const TransitionSnapshot = Transition.omit({ id: true, projectId: true })
export type TransitionSnapshot = z.infer<typeof TransitionSnapshot>

export const EditBatchTransitionEdit = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), transitionId: TransitionId }),
  z.object({ op: z.literal('delete'), transitionId: TransitionId, before: TransitionSnapshot }),
])
export type EditBatchTransitionEdit = z.infer<typeof EditBatchTransitionEdit>

export const transitionSnapshotOf = (transition: Transition): TransitionSnapshot =>
  TransitionSnapshot.parse({
    fromShotId: transition.fromShotId,
    toShotId: transition.toShotId,
    type: transition.type,
    durationSec: transition.durationSec,
  })
