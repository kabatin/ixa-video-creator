'use client'

import type { ProjectId } from '@ixa/domain'
import { useId, useMemo, useState } from 'react'
import { ProjectList } from '@/components/project-list'
import type { WireProjectListItem } from '@/lib/api-schemas'
import {
  DEFAULT_PROJECT_SORT,
  PROJECT_SORT_OPTIONS,
  isProjectSortKey,
  projectListView,
  type ProjectSortKey,
} from '@/lib/project-list-view'
import type { PosterView } from '@/lib/shot-posters'

export type ProjectBrowserProps = {
  /** 一覧の全行（1 件以上）。0 件のときはこの部品を出さず、空の案内を出す（ページの側）。 */
  readonly projects: readonly WireProjectListItem[]
  readonly covers?: ReadonlyMap<ProjectId, PosterView>
}

/**
 * 作品一覧の中身。名前で探す・並べ方を選ぶ・作品のカード、その下に畳んだ素材置き場。
 *
 * 素材置き場は**はじめは畳む**（作品として書き出さないので、どれを開くか選ぶときに邪魔になる）。
 * 検索語が素材置き場に当たっている間は開く。開け閉めを押したら、次に検索語を変えるまではその通りにする。
 * 素材置き場が 1 件も無ければ段ごと出さない。
 */
export const ProjectBrowser = ({ projects, covers }: ProjectBrowserProps) => {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ProjectSortKey>(DEFAULT_PROJECT_SORT)
  /** 押して決めた開け閉め。null は「検索語に任せる」。 */
  const [libraryToggled, setLibraryToggled] = useState<boolean | null>(null)
  const libraryRegionId = useId()

  const view = useMemo(() => projectListView(projects, query, sort), [projects, query, sort])
  const hasLibrary = useMemo(() => projects.some((project) => project.kind === 'library'), [projects])
  const searching = query.trim() !== ''
  const libraryOpen = libraryToggled ?? (searching && view.library.length > 0)
  const nothingMatches = searching && view.works.length === 0 && view.library.length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          placeholder="プロジェクトを検索"
          aria-label="プロジェクトを検索"
          onChange={(event) => {
            setQuery(event.target.value)
            setLibraryToggled(null)
          }}
          className="h-7 w-full max-w-xs rounded border border-line-strong bg-bg px-2 text-sm text-text"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          並べ方
          <select
            value={sort}
            onChange={(event) => {
              if (isProjectSortKey(event.target.value)) setSort(event.target.value)
            }}
            className="h-7 rounded border border-line-strong bg-bg px-2 text-sm text-text"
          >
            {PROJECT_SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {nothingMatches && (
        <p role="status" className="text-sm text-muted">
          {`「${query.trim()}」に当たるプロジェクトはありません。`}
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setLibraryToggled(null)
            }}
            className="ml-2 text-text underline hover:text-accent"
          >
            検索語を消す
          </button>
        </p>
      )}

      {view.works.length > 0 && <ProjectList projects={view.works} covers={covers} />}

      {hasLibrary && (
        <section aria-label="素材置き場" className="border-t border-line pt-4">
          <button
            type="button"
            aria-expanded={libraryOpen}
            aria-controls={libraryRegionId}
            onClick={() => setLibraryToggled(!libraryOpen)}
            className="flex items-center gap-2 text-sm font-medium text-text hover:text-accent"
          >
            <span aria-hidden="true">{libraryOpen ? '▾' : '▸'}</span>
            {`素材置き場（${String(view.library.length)} 件）`}
          </button>
          {libraryOpen && (
            <div id={libraryRegionId} className="mt-3">
              <ProjectList projects={view.library} covers={covers} />
            </div>
          )}
        </section>
      )}
    </div>
  )
}
