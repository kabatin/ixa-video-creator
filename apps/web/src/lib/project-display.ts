import type { Project, ProjectStatus } from '@ixa/domain'

const STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  planning: '企画',
  production: '制作',
  review: 'レビュー',
  finalizing: '仕上げ',
  done: '完了',
}

const STATUS_CLASSES: Readonly<Record<ProjectStatus, string>> = {
  planning: 'bg-slate-100 text-slate-700',
  production: 'bg-blue-100 text-blue-800',
  review: 'bg-amber-100 text-amber-800',
  finalizing: 'bg-violet-100 text-violet-800',
  done: 'bg-emerald-100 text-emerald-800',
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
