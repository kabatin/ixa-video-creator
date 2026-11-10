import type { ProjectKind } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROJECT_SORT,
  PROJECT_SORT_OPTIONS,
  isProjectSortKey,
  projectListView,
  type ListableProject,
} from '@/lib/project-list-view'

/**
 * 作品一覧の並べ方と検索。素材置き場（`library`）は別の束に分け、どちらも同じ検索と並びを掛ける。
 */

type Row = ListableProject & { readonly id: string }

const row = (id: string, name: string, kind: ProjectKind, created: string, activity: string): Row => ({
  id,
  name,
  kind,
  createdAt: new Date(created),
  activity: { lastActivityAt: new Date(activity) },
})

const ROWS: readonly Row[] = [
  row('01A', 'NIGHT RUN', 'mv', '2026-10-01T00:00:00Z', '2026-11-09T00:00:00Z'),
  row('01B', '進め！戦子ちゃん！', 'short', '2026-10-05T00:00:00Z', '2026-11-10T00:00:00Z'),
  row('01C', 'あさやけ', 'kamishibai', '2026-10-03T00:00:00Z', '2026-11-01T00:00:00Z'),
  row('01D', 'キャラ置き場', 'library', '2026-09-01T00:00:00Z', '2026-11-08T00:00:00Z'),
  row('01E', '曲の置き場', 'library', '2026-09-02T00:00:00Z', '2026-11-09T12:00:00Z'),
]

const ids = (rows: readonly Row[]): readonly string[] => rows.map((r) => r.id)

describe('projectListView', () => {
  it('素材置き場を分け、既定は最近更新した順', () => {
    expect(DEFAULT_PROJECT_SORT).toBe('recent')
    const view = projectListView(ROWS, '', 'recent')
    expect(ids(view.works)).toEqual(['01B', '01A', '01C'])
    expect(ids(view.library)).toEqual(['01E', '01D'])
  })

  it('新しく作った順', () => {
    expect(ids(projectListView(ROWS, '', 'created').works)).toEqual(['01B', '01C', '01A'])
  })

  it('名前順は日本語の並び（英字・かな・漢字）', () => {
    const names = projectListView(ROWS, '', 'name').works.map((r) => r.name)
    const collator = new Intl.Collator('ja')
    expect(names).toEqual([...names].sort((a, b) => collator.compare(a, b)))
    expect(names[0]).toBe('NIGHT RUN')
  })

  it('同じ値の行は id で並べ、並びが揺れない', () => {
    const same = [
      row('01Z', '同じ', 'mv', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'),
      row('01Y', '同じ', 'mv', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'),
    ]
    for (const sort of ['recent', 'created', 'name'] as const) {
      expect(ids(projectListView(same, '', sort).works)).toEqual(['01Y', '01Z'])
    }
  })

  it('名前で絞る（全角でも、素材置き場にも掛ける）', () => {
    expect(ids(projectListView(ROWS, 'ＮＩＧＨＴ', 'recent').works)).toEqual(['01A'])
    const library = projectListView(ROWS, '置き場', 'recent')
    expect(library.works).toEqual([])
    expect(ids(library.library)).toEqual(['01E', '01D'])
  })

  it('渡した配列を並べ替えない', () => {
    const before = ids(ROWS)
    projectListView(ROWS, '', 'name')
    expect(ids(ROWS)).toEqual(before)
  })
})

describe('並べ方の選択肢', () => {
  it('3 つの言葉', () => {
    expect(PROJECT_SORT_OPTIONS.map((o) => o.label)).toEqual(['最近更新した順', '新しく作った順', '名前順'])
  })

  it('知らない値は並べ方として読まない', () => {
    expect(isProjectSortKey('name')).toBe(true)
    expect(isProjectSortKey('updated')).toBe(false)
  })
})
