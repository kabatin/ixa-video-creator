import type { Project, ProjectId, WorkspaceId } from '@ixa/domain'
import { EmptyState } from '@/components/empty-state'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { ProjectList } from '@/components/project-list'
import { ProjectListActions } from '@/components/project-list-actions'
import { resolveApiBaseUrl, type ApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createServerApiClient, redirectIfUnauthenticated } from '@/lib/server-api-client'
import { pickProjectCover, type PosterView } from '@/lib/shot-posters'
import { NEW_PROJECT_HREF } from '@/lib/site-nav'
import { resolveWorkspaceId } from '@/lib/workspace'
import { LinkButton } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

type LoadResult =
  | { readonly ok: true; readonly projects: readonly Project[] }
  | { readonly ok: false; readonly message: string }

/** API 障害でページを落とさない。失敗は必ず表示可能な値へ畳む。 */
const loadProjects = async (api: ApiClient, workspaceId: WorkspaceId): Promise<LoadResult> => {
  try {
    return { ok: true, projects: await api.listProjects(workspaceId) }
  } catch (error) {
    redirectIfUnauthenticated(error)
    return { ok: false, message: describeError(error) }
  }
}

/**
 * カードの表紙。採用 Take のサムネイルがある先頭の Shot を選ぶ。
 * **取れなかったことは理由として残す。** 空の Map にすると「絵が無い」と区別がつかない。
 */
const loadCovers = async (
  api: ApiClient,
  projects: readonly Project[],
): Promise<ReadonlyMap<ProjectId, PosterView>> => {
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
  <LinkButton href={NEW_PROJECT_HREF} tone="primary">
    新規プロジェクト
  </LinkButton>
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
          hint="作業場所の設定が読めていません。開発の手順書（README）の「はじめに」に沿って設定してください。"
          detail="apps/web/.env.local の NEXT_PUBLIC_WORKSPACE_ID"
        />
      </main>
    )
  }

  const api = await createServerApiClient()
  const result = await loadProjects(api, workspace.workspaceId)
  const covers = result.ok ? await loadCovers(api, result.projects) : new Map<ProjectId, PosterView>()

  return (
    <main>
      <PageHeader
        title="プロジェクト"
        description="カードを押すと、その映像のワークベンチが開きます。"
        action={<NewProjectLink />}
      />
      {!result.ok ? (
        <ErrorPanel
          title="プロジェクトを読み込めませんでした"
          message={result.message}
          hint="サーバが動いているか確かめてください。"
          detail={`サーバの場所: ${resolveApiBaseUrl()}`}
        />
      ) : result.projects.length === 0 ? (
        <EmptyState
          message="プロジェクトがありません"
          actionHref={NEW_PROJECT_HREF}
          actionLabel="最初のプロジェクトを作成"
        />
      ) : (
        // 右上の「…」と右クリックで複製・削除（制作者 2026-10-04）。
        <ProjectListActions>
          <ProjectList projects={result.projects} covers={covers} />
        </ProjectListActions>
      )}
    </main>
  )
}

export default ProjectsPage
