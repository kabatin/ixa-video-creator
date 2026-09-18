import type { Project, ProjectId, WorkspaceId } from '@ixa/domain'
import Link from 'next/link'
import { EmptyState } from '@/components/empty-state'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { ProjectList } from '@/components/project-list'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { pickProjectCover, type PosterView } from '@/lib/shot-posters'
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

/**
 * カードの表紙。採用 Take のサムネイルがある先頭の Shot を選ぶ。
 * **取れなかったことは理由として残す。** 空の Map にすると「絵が無い」と区別がつかない。
 */
const loadCovers = async (
  projects: readonly Project[],
): Promise<ReadonlyMap<ProjectId, PosterView>> => {
  const api = createApiClient()
  const entries = await Promise.all(
    projects.map(async (project): Promise<readonly [ProjectId, PosterView]> => {
      try {
        return [project.id, pickProjectCover(await api.listShotPosters(project.id))]
      } catch (error) {
        return [
          project.id,
          { url: null, reason: `サムネイルを取れませんでした: ${describeError(error)}` },
        ]
      }
    }),
  )
  return new Map(entries)
}

const NewProjectLink = () => (
  <Link
    href="/projects/new"
    className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90"
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
  const covers = result.ok ? await loadCovers(result.projects) : new Map<ProjectId, PosterView>()

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
        <ProjectList projects={result.projects} covers={covers} />
      )}
    </main>
  )
}

export default ProjectsPage
