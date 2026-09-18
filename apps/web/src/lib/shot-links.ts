import type { ProjectId, Shot, ShotId } from '@ixa/domain'
import { legacySectionHref, legacyShotHref } from '@/lib/workbench-url'

/**
 * 画面間のリンク。行き先の組み立てをここに集約する。
 *
 * PHASE 7.1 から Shot 詳細と Shot 一覧はワークベンチに吸収した（UI-WORKBENCH §3.2）。
 * リンクは旧 URL を経由せず、ワークベンチの該当タブを直接指す。
 * 旧 `/shots/[id]?projectId=` は引き継ぎ文書のためにリダイレクトとして残している。
 */
export const PROJECT_ID_PARAM = 'projectId'

/** その Shot を選び、Take 比較とインスペクターを前に出す。 */
export const shotDetailHref = (shot: Pick<Shot, 'id' | 'projectId'>): string =>
  legacyShotHref(shot.projectId, shot.id)

/** Shot 一覧を前に出したワークベンチ。 */
export const shotListHref = (projectId: ProjectId): string => legacySectionHref(projectId, 'shots')

/** 新規 Shot の単独ページ（ワークベンチの外から作るとき）。 */
export const newShotHref = (projectId: ProjectId): string =>
  `/projects/${encodeURIComponent(projectId)}/shots/new`

export const takesAnchorId = (shotId: ShotId): string => `takes-${shotId}`
