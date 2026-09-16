import type { ProjectId, Shot, ShotId } from '@ixa/domain'

/**
 * 画面間のリンク。
 * API に `GET /shots/{id}` が無いため、Shot 詳細は projectId をクエリで受け取り
 * `GET /projects/{projectId}/shots` から該当 Shot を引く。リンクの生成をここに集約する。
 */
export const PROJECT_ID_PARAM = 'projectId'

export const shotDetailHref = (shot: Pick<Shot, 'id' | 'projectId'>): string =>
  `/shots/${encodeURIComponent(shot.id)}?${PROJECT_ID_PARAM}=${encodeURIComponent(shot.projectId)}`

export const shotListHref = (projectId: ProjectId): string =>
  `/projects/${encodeURIComponent(projectId)}/shots`

export const newShotHref = (projectId: ProjectId): string => `${shotListHref(projectId)}/new`

export const takesAnchorId = (shotId: ShotId): string => `takes-${shotId}`
