import type { ProjectActivity, ProjectKind, ProjectStatus } from '@ixa/domain'
import { formatDateTime } from '@/lib/format-date'

const STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  planning: '企画',
  production: '制作',
  review: 'レビュー',
  finalizing: '仕上げ',
  done: '完了',
}

const STATUS_CLASSES: Readonly<Record<ProjectStatus, string>> = {
  planning: 'bg-surface-2 text-text',
  production: 'bg-info/10 text-info',
  review: 'bg-warn/10 text-warn',
  finalizing: 'bg-accent-soft/15 text-text',
  done: 'bg-ok/10 text-ok',
}

export const statusLabel = (status: ProjectStatus): string => STATUS_LABELS[status]

export const statusClassName = (status: ProjectStatus): string => STATUS_CLASSES[status]

/** はじめの状態。どの作品もここから始まり、手で変えるまで動かないので、カードに出しても何も言っていない。 */
const INITIAL_STATUS: ProjectStatus = 'planning'

/** 状態の札を出すか。はじめの「企画」のままなら出さない。 */
export const showsStatusPill = (status: ProjectStatus): boolean => status !== INITIAL_STATUS

/**
 * どこまで進んだか（`Shot 27・Take 20/27・書き出し済み`）。Take の数は**採用した Shot の数**。
 * 書き出しが終わっていなければ書き出しは言わない。Shot が無ければそう言う。
 * 素材置き場は Shot を作らないのがふつうなので、Shot が無ければ何も言わない（null）。
 */
export const projectProgressLine = (
  kind: ProjectKind,
  activity: Pick<ProjectActivity, 'shotCount' | 'adoptedTakeCount' | 'hasRender'>,
): string | null => {
  if (activity.shotCount === 0) return kind === 'library' ? null : 'Shot はまだありません'
  const parts = [
    `Shot ${String(activity.shotCount)}`,
    `Take ${String(activity.adoptedTakeCount)}/${String(activity.shotCount)}`,
    ...(activity.hasRender ? ['書き出し済み'] : []),
  ]
  return parts.join('・')
}

/** 最後に触った時刻（`更新 2026/11/10 14:02`）。 */
export const lastActivityLabel = (activity: Pick<ProjectActivity, 'lastActivityAt'>): string =>
  `更新 ${formatDateTime(activity.lastActivityAt)}`
