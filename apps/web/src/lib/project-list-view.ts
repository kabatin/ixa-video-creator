import type { ProjectActivity, ProjectKind } from '@ixa/domain'
import { matchesTextQuery } from '@/lib/text-query'

/**
 * 作品一覧の並べ方と検索。**React を含まない。**
 * 素材置き場（`library`）は作品として書き出さないので別の束に分け、一覧では畳む。どちらにも同じ検索と並びを掛ける。
 */

/** 並べ方と検索に要る欄だけ。 */
export type ListableProject = {
  readonly id: string
  readonly name: string
  readonly kind: ProjectKind
  readonly createdAt: Date
  readonly activity: Pick<ProjectActivity, 'lastActivityAt'>
}

export const PROJECT_SORT_KEYS = ['recent', 'created', 'name'] as const
export type ProjectSortKey = (typeof PROJECT_SORT_KEYS)[number]

export const DEFAULT_PROJECT_SORT: ProjectSortKey = 'recent'

export const PROJECT_SORT_OPTIONS: readonly { readonly key: ProjectSortKey; readonly label: string }[] = Object.freeze([
  { key: 'recent', label: '最近更新した順' },
  { key: 'created', label: '新しく作った順' },
  { key: 'name', label: '名前順' },
])

export const isProjectSortKey = (value: string): value is ProjectSortKey =>
  (PROJECT_SORT_KEYS as readonly string[]).includes(value)

const nameCollator = new Intl.Collator('ja')

/** 並びの比べ方。同じ値どうしは id で並べ、読み直しても並びが揺れない。 */
const COMPARE: Readonly<Record<ProjectSortKey, (a: ListableProject, b: ListableProject) => number>> = Object.freeze({
  recent: (a, b) => b.activity.lastActivityAt.getTime() - a.activity.lastActivityAt.getTime(),
  created: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  name: (a, b) => nameCollator.compare(a.name, b.name),
})

const byId = (a: ListableProject, b: ListableProject): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export type ProjectListView<T> = {
  /** 作品（素材置き場でないもの）。 */
  readonly works: readonly T[]
  /** 素材置き場。 */
  readonly library: readonly T[]
}

/** 名前で絞り、並べ、作品と素材置き場に分ける。渡した配列は変えない。 */
export const projectListView = <T extends ListableProject>(
  rows: readonly T[],
  query: string,
  sort: ProjectSortKey,
): ProjectListView<T> => {
  const compare = COMPARE[sort]
  const sorted = rows
    .filter((row) => matchesTextQuery(row.name, query))
    .toSorted((a, b) => compare(a, b) || byId(a, b))
  return {
    works: sorted.filter((row) => row.kind !== 'library'),
    library: sorted.filter((row) => row.kind === 'library'),
  }
}
