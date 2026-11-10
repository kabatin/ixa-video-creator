import type { ProjectId, WorkspaceId } from '@ixa/domain'
import { EmptyState } from '@/components/empty-state'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { PosterRenewalOnRefresh } from '@/components/poster-renewal-on-refresh'
import { ProjectBrowser } from '@/components/project-browser'
import { ProjectListActions } from '@/components/project-list-actions'
import { resolveApiBaseUrl, type ApiClient } from '@/lib/api-client'
import type { WireProjectListItem } from '@/lib/api-schemas'
import { describeError } from '@/lib/api-error'
import { demoEntrance, unreadableDemoEntrance, type DemoEntrance } from '@/lib/demo-entrance'
import { getDemoStatus } from '@/lib/demo-status-server'
import { toProjectListEntry } from '@/lib/project-list-entry'
import { createServerApiClient, redirectIfUnauthenticated } from '@/lib/server-api-client'
import { pickProjectCover, type PosterView } from '@/lib/shot-posters'
import { NEW_PROJECT_HREF } from '@/lib/site-nav'
import { resolveWorkspaceId } from '@/lib/workspace'
import { LinkButton } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

type LoadResult =
  | { readonly ok: true; readonly projects: readonly WireProjectListItem[] }
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
  projects: readonly WireProjectListItem[],
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

/**
 * 「見本を開く」を出すか（ADR-0067）。**確かめられなかったことは理由として残す**（黙って隠すと「見本は無い」と読める）。
 */
const loadDemoEntrance = async (workspaceId: WorkspaceId): Promise<DemoEntrance> => {
  try {
    return demoEntrance(await getDemoStatus(workspaceId))
  } catch (error) {
    redirectIfUnauthenticated(error)
    return unreadableDemoEntrance(describeError(error))
  }
}

/** 作品が 1 件も無いときの補足。何をする道具かを 3 行で（作品の作り方の流れ）。 */
const FIRST_STEPS: readonly string[] = Object.freeze([
  '曲やナレーションに合わせて Shot を切ります',
  'Shot ごとに絵と動画を AI で作り、良い Take を選びます',
  'つないで 1 本の動画に書き出します',
])

/** 見本の入口は、新規の左に並べる（見本が用意されていて、まだ入れていないときだけ）。 */
const HeaderActions = ({ demo }: { readonly demo: DemoEntrance }) => (
  <div className="flex flex-wrap items-center gap-2">
    {demo.kind === 'offer' && <LinkButton href={demo.href}>{demo.label}</LinkButton>}
    <LinkButton href={NEW_PROJECT_HREF} tone="primary">
      新規プロジェクト
    </LinkButton>
  </div>
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
  // 表紙の URL を発行する時刻。画面はここから 1 分を数える（戻るボタンで出た古いページを見分けるため）。
  const coversIssuedAtMs = Date.now()
  // 一覧が読めなかったときは見本も聞かない（同じ理由で失敗し、エラーが 2 つ並ぶだけになる）。
  const [covers, demo]: readonly [ReadonlyMap<ProjectId, PosterView>, DemoEntrance] = result.ok
    ? await Promise.all([loadCovers(api, result.projects), loadDemoEntrance(workspace.workspaceId)])
    : [new Map(), { kind: 'none' }]

  return (
    <main>
      <PageHeader
        title="プロジェクト"
        description="カードを押すと、その映像のワークベンチが開きます。"
        action={<HeaderActions demo={demo} />}
      />
      {demo.kind === 'unreadable' && (
        <p role="status" className="mb-4 text-sm text-muted">
          {demo.message}
        </p>
      )}
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
          hint={FIRST_STEPS}
          {...(demo.kind === 'offer' ? { secondaryHref: demo.href, secondaryLabel: demo.label } : {})}
        />
      ) : (
        // 右下の「…」と右クリックで複製・削除・素材置き場にする（制作者 2026-10-04）。検索・並べ方・素材置き場の畳みは ProjectBrowser。
        <ProjectListActions>
          {/* 表紙の URL は 5 分で切れる。読めなくなったらページを描き直して新しい URL をもらう。 */}
          <PosterRenewalOnRefresh issuedAtMs={coversIssuedAtMs}>
            {/* 一覧が使う欄だけを渡す（行をそのまま渡すと、歌詞や方針まで全作品分ブラウザへ届く）。 */}
            <ProjectBrowser projects={result.projects.map((row) => toProjectListEntry(row, covers.get(row.id)))} />
          </PosterRenewalOnRefresh>
        </ProjectListActions>
      )}
    </main>
  )
}

export default ProjectsPage
