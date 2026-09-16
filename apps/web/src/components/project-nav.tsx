import Link from 'next/link'
import type { ProjectId } from '@ixa/domain'
import {
  PROJECT_SECTIONS,
  projectSectionHref,
  type ProjectSection,
} from '@/lib/project-links'

/**
 * Project 配下の画面を行き来するためのナビゲーション。
 * すべての Project 配下の画面に同じものを置き、どこからでも全部へ行けるようにする。
 */
export type ProjectNavProps = {
  readonly projectId: ProjectId
  /** いま開いている画面。リンクにせず現在地として見せる。 */
  readonly current: ProjectSection
}

export const ProjectNav = ({ projectId, current }: ProjectNavProps) => (
  <nav aria-label="プロジェクトの画面" className="flex flex-wrap items-center gap-3">
    <Link href="/" className="text-sm text-slate-600 underline hover:text-slate-900">
      プロジェクト一覧
    </Link>
    <span aria-hidden className="text-slate-300">
      /
    </span>
    {PROJECT_SECTIONS.map((section) =>
      section.key === current ? (
        <span
          key={section.key}
          aria-current="page"
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          {section.label}
        </span>
      ) : (
        <Link
          key={section.key}
          href={projectSectionHref(projectId, section.key)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          {section.label}
        </Link>
      ),
    )}
  </nav>
)
