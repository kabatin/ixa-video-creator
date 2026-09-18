import type { Project } from '@ixa/domain'
import Link from 'next/link'
import { ShotPoster } from '@/components/shot-poster'
import { formatResolution } from '@/lib/resolution-presets'
import { formatCreatedAt, statusClassName, statusLabel } from '@/lib/project-display'
import { PROJECT_SECTIONS, projectSectionHref } from '@/lib/project-links'

export type ProjectCardProps = {
  readonly project: Project
  /**
   * 表紙にする絵（`pickProjectCover` が選ぶ）。**`undefined` は「呼び出し側がまだ繋いでいない」**。
   * `null` は「繋がっているが絵が無い」で、そのときは `coverReason` に理由が入る。
   * 2 つを混ぜると、繋ぎ忘れが「Take がありません」に化ける（L-021）。
   */
  readonly coverUrl?: string | null
  readonly coverReason?: string | null
}

export const ProjectCard = ({ project, coverUrl, coverReason }: ProjectCardProps) => (
  <li className="rounded-lg border border-line bg-surface p-5 shadow-sm">
    {(coverUrl !== undefined || coverReason !== undefined) && (
      <div className="mb-4">
        <ShotPoster
          url={coverUrl ?? null}
          reason={coverReason ?? null}
          alt={`${project.name} の表紙`}
          size="card"
        />
      </div>
    )}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-text">{project.name}</h2>
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClassName(project.status)}`}
      >
        {statusLabel(project.status)}
      </span>
    </div>
    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-muted sm:grid-cols-4">
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">解像度</dt>
        <dd>{formatResolution(project.resolution)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">アスペクト比</dt>
        <dd>{project.aspectRatio}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">fps</dt>
        <dd>{project.fps}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">作成日</dt>
        <dd>{formatCreatedAt(project)}</dd>
      </div>
    </dl>
    {/* 画面を足したら project-links.ts に追記する。ここは自動で増える。 */}
    <div className="mt-4 flex flex-wrap gap-3">
      {PROJECT_SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={projectSectionHref(project.id, section.key)}
          className="text-sm font-medium text-text underline hover:text-muted"
        >
          {section.label}
        </Link>
      ))}
    </div>
  </li>
)
