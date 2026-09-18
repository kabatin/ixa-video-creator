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
  'focus-visible:outline-focus'

/**
 * 現在地。**主ボタンと同じ見た目にしないこと。**
 * 以前は主ボタンと同じ塗りつぶし（濃い地に白文字）で、隣の「新規 Shot」ボタンと区別が付かず、
 * 押せそうに見えて押せなかった。塗りつぶしはやめ、へこんだタブとして見せる。
 */
const CURRENT_CLASS =
  'rounded-md bg-surface-2 px-3 py-1.5 text-sm font-semibold text-text ' +
  'ring-1 ring-inset ring-line-strong'

const LINK_CLASS = `rounded-md border border-line-strong px-3 py-1.5 text-sm text-text hover:bg-surface-2 ${FOCUS_CLASS}`

export const ProjectNav = ({ projectId, current }: ProjectNavProps) => (
  <nav aria-label="プロジェクトの画面" className="flex flex-wrap items-center gap-3">
    <Link
      href="/"
      className={`rounded-sm text-sm text-text underline hover:text-accent ${FOCUS_CLASS}`}
    >
      プロジェクト一覧
    </Link>
    <span aria-hidden className="text-faint">
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
