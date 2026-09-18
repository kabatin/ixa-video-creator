import type { Project, ProjectStatus } from '@ixa/domain'

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

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export const formatCreatedAt = (project: Project): string => dateFormatter.format(project.createdAt)
