import { ProjectId, type Project } from '@ixa/domain'
import { ErrorPanel } from '@/components/error-panel'
import { ProjectNav } from '@/components/project-nav'
import { PageHeader } from '@/components/page-header'
import { ProjectSettingsForm } from '@/components/project-settings-form'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'

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

const ProjectSettingsPage = async ({ params }: SettingsPageProps) => {
  const { id } = await params
  const result = await loadProject(id)

  if (result.kind === 'missing') {
    return (
      <main className="mx-auto w-full max-w-3xl">
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
      <main className="mx-auto w-full max-w-3xl">
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
    <main className="mx-auto w-full max-w-3xl">
      <PageHeader
        title={`設定 — ${result.project.name}`}
        description="出力仕様と制作の制約を変更します。生成済みの Take には遡って効きません。"
        action={<ProjectNav current="settings" projectId={result.project.id} />}
      />
      <ProjectSettingsForm project={result.project} />
    </main>
  )
}

export default ProjectSettingsPage
