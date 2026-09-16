import Link from 'next/link'
import type { ProjectId } from '@ixa/domain'
import { PROJECT_SECTIONS, projectSectionHref, type ProjectSection } from '@/lib/project-links'

/**
 * Project 配下の画面を行き来するためのナビゲーション。
 * すべての Project 配下の画面に同じものを置き、どこからでも全部へ行けるようにする。
 */
export type ProjectNavProps = {
  readonly projectId: ProjectId
  /** いま開いている画面。リンクにせず現在地として見せる。 */
  readonly current: ProjectSection
}

const FOCUS_CLASS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-slate-900'

/**
 * 現在地。**主ボタンと同じ見た目にしないこと。**
 * 以前は `bg-slate-900 text-white` で、隣の「新規 Shot」ボタンと区別が付かず、
 * 押せそうに見えて押せなかった。塗りつぶしはやめ、へこんだタブとして見せる。
 */
const CURRENT_CLASS =
  'rounded-md bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-900 ' +
  'ring-1 ring-inset ring-slate-300'

const LINK_CLASS = `rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 ${FOCUS_CLASS}`

export const ProjectNav = ({ projectId, current }: ProjectNavProps) => (
  <nav aria-label="プロジェクトの画面" className="flex flex-wrap items-center gap-3">
    <Link
      href="/"
      className={`rounded-sm text-sm text-slate-700 underline hover:text-slate-900 ${FOCUS_CLASS}`}
    >
      プロジェクト一覧
    </Link>
    <span aria-hidden className="text-slate-400">
      /
    </span>
    {PROJECT_SECTIONS.map((section) =>
      section.key === current ? (
        <span key={section.key} aria-current="page" className={CURRENT_CLASS}>
          {section.label}
        </span>
      ) : (
        <Link
          key={section.key}
          href={projectSectionHref(projectId, section.key)}
          className={LINK_CLASS}
        >
          {section.label}
        </Link>
      ),
    )}
  </nav>
)
