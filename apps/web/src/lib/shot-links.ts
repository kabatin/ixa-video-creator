import type { Shot, ShotId } from '@ixa/domain'
import { shotHref } from '@/lib/workbench-url'

/**
 * Shot を指すリンク。
 *
 * Shot 詳細も Shot 一覧もワークベンチの中にある（UI-WORKBENCH §3.2）。
 * 外から指せるのは「その Shot を開いた状態のワークベンチ」だけで、
 * 一覧だけを開く URL は用意しない（パネルの出し入れは中で決めることなので、
 * 入口で選ばせる意味が無い）。
 */
export const PROJECT_ID_PARAM = 'projectId'

/** その Shot を選び、Take 比較とインスペクターを前に出す。 */
export const shotDetailHref = (shot: Pick<Shot, 'id' | 'projectId'>): string =>
  shotHref(shot.projectId, shot.id)

export const takesAnchorId = (shotId: ShotId): string => `takes-${shotId}`
