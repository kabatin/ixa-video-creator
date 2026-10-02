import type { Shot } from '@ixa/domain'
import { shotBoundaryChanges, shotEditBlockedReason, shotSpanChanges, type RoughCutChange } from '@ixa/timeline'
import type { ClipDragHandle, ClipDragOutcome } from '@/lib/timeline-drag'
import { edgeNeighbors, type EdgeNeighbors } from '@/lib/timeline-rolling'

/**
 * カット（VIDEO1 の Shot）の端をドラッグして長さを変える（制作者 2026-10-02「CUT4 の右側をつまんで右に移動したら
 * CUT5 の先頭が後ろに追従して下がる感じ、逆もしかり、左側も同様」）。**React を含まない純粋な関数。**
 *
 * 端の動き（隣が付いてくる・止まる所）はテロップと同じ `timeline-rolling.ts`。
 * 離したときの変更は `@ixa/timeline` の `shotBoundaryChanges`（境目を歌い出しに揃えるのと同じ計算）で作り、
 * 粗編集の適用で当てる（古さ・ロックの検査と変更の履歴がある）。
 */

export const shotEdgeNeighbors = (shots: readonly Shot[], shot: Shot): EdgeNeighbors =>
  edgeNeighbors(
    shots.map((each) => ({ id: each.id, span: each })),
    { id: shot.id, span: shot },
  )

/**
 * 掴めない理由。自分か、その端に接していて付いてくる隣がロック中・生成中なら掴ませない。
 * 掴めてから離した所で断られると、引いた手間が無駄になる。
 */
export const shotEdgeGrabBlocked = (
  shot: Shot,
  handle: ClipDragHandle,
  neighbors: EdgeNeighbors,
  shots: readonly Shot[],
): string | null => {
  const own = shotEditBlockedReason(shot)
  if (own !== null || handle === 'body') return own
  const adjacent = handle === 'end' ? neighbors.after.adjacent : neighbors.before.adjacent
  const neighbor = adjacent === null ? undefined : shots.find((each) => each.id === adjacent.id)
  return neighbor === undefined ? null : shotEditBlockedReason(neighbor)
}

export type ShotEdgeEdit = {
  readonly changes: readonly RoughCutChange[]
  /** 変更の履歴の見出し。 */
  readonly summary: string
  /** 当てられない理由。当てられるなら null。 */
  readonly problem: string | null
}

/** 離したときに送る変更。隣が付いてきたなら境目を動かし、付いてこなければそのカットだけを変える。 */
export const shotEdgeEdit = (shots: readonly Shot[], shot: Shot, outcome: ClipDragOutcome): ShotEdgeEdit => {
  const { neighbor } = outcome
  const neighborShot = neighbor === null ? undefined : shots.find((each) => each.id === neighbor.id)
  if (neighborShot === undefined) {
    const span = shotSpanChanges(shot, outcome.span)
    return { ...span, changes: outcome.moved ? span.changes : [], summary: `${shot.code} の長さを変えました` }
  }
  const [previous, later, boundarySec] =
    outcome.handle === 'end'
      ? [shot, neighborShot, outcome.span.startSec + outcome.span.durationSec]
      : [neighborShot, shot, outcome.span.startSec]
  const boundary = shotBoundaryChanges(shots, new Map([[later.id, boundarySec]]))
  return {
    ...boundary,
    changes: outcome.moved ? boundary.changes : [],
    summary: `${previous.code} と ${later.code} の境目を動かしました`,
  }
}
