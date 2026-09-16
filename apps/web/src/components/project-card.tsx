import type { Project } from '@ixa/domain'
import Link from 'next/link'
import { formatResolution } from '@/lib/resolution-presets'
import { formatCreatedAt, statusClassName, statusLabel } from '@/lib/project-display'
import { PROJECT_SECTIONS, projectSectionHref } from '@/lib/project-links'

export type ProjectCardProps = {
  readonly project: Project
}

export const ProjectCard = ({ project }: ProjectCardProps) => (
  <li className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-slate-900">{project.name}</h2>
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClassName(project.status)}`}
      >
        {statusLabel(project.status)}
      </span>
    </div>
    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-slate-600 sm:grid-cols-4">
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-400">解像度</dt>
        <dd>{formatResolution(project.resolution)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-400">アスペクト比</dt>
        <dd>{project.aspectRatio}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-400">fps</dt>
        <dd>{project.fps}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-400">作成日</dt>
        <dd>{formatCreatedAt(project)}</dd>
      </div>
    </dl>
    {/* 画面を足したら project-links.ts に追記する。ここは自動で増える。 */}
    <div className="mt-4 flex flex-wrap gap-3">
      {PROJECT_SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={projectSectionHref(project.id, section.key)}
          className="text-sm font-medium text-slate-900 underline hover:text-slate-600"
        >
          {section.label}
        </Link>
      ))}
    </div>
  </li>
)
