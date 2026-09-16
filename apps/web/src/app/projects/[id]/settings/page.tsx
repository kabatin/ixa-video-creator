import { ProjectId, type Project } from '@ixa/domain'
import Link from 'next/link'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { ProjectSettingsForm } from '@/components/project-settings-form'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { PROJECT_SECTIONS, projectSectionHref } from '@/lib/project-links'

/**
 * Project の設定（P55-9）。
 *
 * **「存在しない」と「読めなかった」を畳まない**（lessons L-015）。
 * 前者は URL が古い、後者は API 側の異常で、利用者に求める次の行動が違う。
 */

export const dynamic = 'force-dynamic'

const PROJECT_LIST_HREF = '/'

const backToProjects = Object.freeze([
  Object.freeze({ href: PROJECT_LIST_HREF, label: 'プロジェクト一覧へ' }),
])

type SettingsPageProps = {
  readonly params: Promise<{ readonly id: string }>
}

type LoadResult =
  | { readonly kind: 'ready'; readonly project: Project }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly message: string }

const loadProject = async (rawId: string): Promise<LoadResult> => {
  const id = ProjectId.safeParse(rawId)
  if (!id.success) return { kind: 'missing' }

  try {
    const project = await createApiClient().getProject(id.data)
    return project === null ? { kind: 'missing' } : { kind: 'ready', project }
  } catch (error) {
    return { kind: 'unreadable', message: describeError(error) }
  }
}

/**
 * Project 配下の画面への入口。
 *
 * **`ProjectNav` を使っていないのは、`ProjectSection` にまだ `settings` が無いため。**
 * `project-links.ts` は Architect の所有ファイルなので、勝手に足さずここでリンクを組む。
 * `settings` が `PROJECT_SECTIONS` に入ったら `<ProjectNav current="settings" />` に置き換える。
 */
const SettingsNav = ({ projectId }: { readonly projectId: ProjectId }) => (
  <nav aria-label="プロジェクトの画面" className="flex flex-wrap items-center gap-3">
    <Link href={PROJECT_LIST_HREF} className="rounded-sm text-sm text-slate-700 underline hover:text-slate-900">
      プロジェクト一覧
    </Link>
    <span aria-hidden className="text-slate-400">
      /
    </span>
    {PROJECT_SECTIONS.map((section) => (
      <Link
        key={section.key}
        href={projectSectionHref(projectId, section.key)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
      >
        {section.label}
      </Link>
    ))}
    <span
      aria-current="page"
      className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-900 ring-1 ring-inset ring-slate-300"
    >
      設定
    </span>
  </nav>
)

const ProjectSettingsPage = async ({ params }: SettingsPageProps) => {
  const { id } = await params
  const result = await loadProject(id)

  if (result.kind === 'missing') {
    return (
      <main>
        <PageHeader title="プロジェクトの設定" />
        <ErrorPanel
          title="プロジェクトが見つかりません"
          message="URL が古いか、すでに削除された可能性があります。"
          hint="一覧から辿り直してください。"
          actions={backToProjects}
        />
      </main>
    )
  }

  if (result.kind === 'unreadable') {
    return (
      <main>
        <PageHeader title="プロジェクトの設定" />
        <ErrorPanel
          title="プロジェクトを読み込めませんでした"
          message={result.message}
          hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
          actions={backToProjects}
        />
      </main>
    )
  }

  return (
    <main>
      <PageHeader
        title={`設定 — ${result.project.name}`}
        description="出力仕様と制作の制約を変更します。生成済みの Take には遡って効きません。"
        action={<SettingsNav projectId={result.project.id} />}
      />
      <ProjectSettingsForm project={result.project} />
    </main>
  )
}

export default ProjectSettingsPage
