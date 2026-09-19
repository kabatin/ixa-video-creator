import type { Shot, ShotId, ShotStatus } from '@ixa/domain'

/**
 * 右の Shot 一覧の並べ方・絞り方・範囲選択（UI-WORKBENCH-2 §7）。**React を含まない。**
 */

export type ShotSortKey = 'order' | 'duration' | 'status'
export type SortDirection = 'asc' | 'desc'

/** 状態は制作の流れの順（下書き → 承認）。アルファベット順にしない。 */
const STATUS_ORDER: readonly ShotStatus[] = ['draft', 'ready', 'generating', 'review', 'blocked', 'approved']

const compare = (key: ShotSortKey) => (a: Shot, b: Shot): number => {
  switch (key) {
    case 'order':
      return a.order - b.order
    case 'duration':
      return a.durationSec - b.durationSec || a.order - b.order
    case 'status':
      return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.order - b.order
  }
}

/** 新しい配列を返す（入力は変えない）。同じ値どうしは元の並び（order）を保つ。 */
export const sortShots = (
  shots: readonly Shot[],
  key: ShotSortKey,
  direction: SortDirection,
): readonly Shot[] => {
  const sorted = [...shots].sort(compare(key))
  return direction === 'asc' ? sorted : sorted.reverse()
}

/** 状態ごとの件数。**0 件の状態は含めない**（押しても空になるチップを並べない）。 */
export const statusCounts = (
  shots: readonly Pick<Shot, 'status'>[],
): readonly (readonly [ShotStatus, number])[] =>
  STATUS_ORDER.flatMap((status) => {
    const count = shots.filter((shot) => shot.status === status).length
    return count === 0 ? [] : [[status, count] as const]
  })

/**
 * Shift で範囲を選ぶ（表計算ソフトの作法）。起点から押した行までの ID を、見えている並びで返す。
 * 起点が見えていなければ押した行だけ。
 */
export const rangeBetween = (
  visibleIds: readonly ShotId[],
  anchorId: ShotId | null,
  targetId: ShotId,
): readonly ShotId[] => {
  const to = visibleIds.indexOf(targetId)
  const from = anchorId === null ? -1 : visibleIds.indexOf(anchorId)
  if (to < 0) return []
  if (from < 0) return [targetId]
  const [start, end] = from <= to ? [from, to] : [to, from]
  return visibleIds.slice(start, end + 1)
}
