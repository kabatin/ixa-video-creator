import type { Shot, ShotId } from '@ixa/domain'

/**
 * 「選んだ Shot」が何を指すか（削除・書き出しで共通。制作者の要望 2026-09-26・2026-10-02）。
 *
 * **チェックがあればチェックした Shot、無ければ選んでいる Shot。** 右クリックのメニューから来たときは、
 * 右クリックした Shot だけ（チェックとは混ぜない）。
 */
export const resolveShotTargets = (
  shots: readonly Shot[],
  checked: ReadonlySet<ShotId>,
  selectedShotId: ShotId | null,
  /** 右クリックのメニューから来たときの対象（右クリックした Shot だけ。チェックとは混ぜない）。 */
  explicit: readonly ShotId[] | null = null,
): readonly Shot[] =>
  explicit !== null
    ? shots.filter((shot) => explicit.includes(shot.id))
    : checked.size > 0
      ? shots.filter((shot) => checked.has(shot.id))
      : shots.filter((shot) => shot.id === selectedShotId)
