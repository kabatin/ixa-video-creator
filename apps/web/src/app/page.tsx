import type { Project, WorkspaceId } from '@ixa/domain'
import Link from 'next/link'
import { EmptyState } from '@/components/empty-state'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { ProjectList } from '@/components/project-list'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { resolveWorkspaceId } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

type LoadResult =
  | { readonly ok: true; readonly projects: readonly Project[] }
  | { readonly ok: false; readonly message: string }

/** API 障害でページを落とさない。失敗は必ず表示可能な値へ畳む。 */
const loadProjects = async (workspaceId: WorkspaceId): Promise<LoadResult> => {
  try {
    return { ok: true, projects: await createApiClient().listProjects(workspaceId) }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}

const NewProjectLink = () => (
  <Link
    href="/projects/new"
    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
  >
    新規プロジェクト
  </Link>
)

const ProjectsPage = async () => {
  const workspace = resolveWorkspaceId()

  if (!workspace.ok) {
    return (
      <main>
        <PageHeader title="プロジェクト" />
        <ErrorPanel
          title="設定が不足しています"
          message={workspace.reason}
          hint="apps/web/.env.local に NEXT_PUBLIC_WORKSPACE_ID を設定してください。"
        />
      </main>
    )
  }

  const result = await loadProjects(workspace.workspaceId)

  return (
    <main>
      <PageHeader
        title="プロジェクト"
        description="AI ネイティブ映像制作プラットフォーム"
        action={<NewProjectLink />}
      />
      {!result.ok ? (
        <ErrorPanel
          title="プロジェクトを読み込めませんでした"
          message={result.message}
          hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
        />
      ) : result.projects.length === 0 ? (
        <EmptyState
          message="プロジェクトがありません"
          actionHref="/projects/new"
          actionLabel="最初のプロジェクトを作成"
        />
      ) : (
        <ProjectList projects={result.projects} />
      )}
    </main>
  )
}

export default ProjectsPage
