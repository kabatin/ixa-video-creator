import { ProjectId } from '@ixa/domain'
import Link from 'next/link'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { RenderPanel } from '@/components/render-panel'
import { TimelineIssuePanel } from '@/components/timeline-issue-panel'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { projectSectionHref } from '@/lib/project-links'
import { createRenderApi, type WireRenderJob } from '@/lib/render-api'
import { createRequester } from '@/lib/requester'
import { createTimelineApi } from '@/lib/timeline-api'
import type { TimelineIssueView } from '@/lib/timeline-issues'

/**
 * 書き出し（レンダリング）画面（P55-3）。
 *
 * ここまで API と worker はあったのに、**画面から呼ぶ経路が 1 つも無かった。**
 * タイムライン画面は「書き出しが 422 で拒否される」と警告していたが、
 * その書き出し自体に到達できなかった。
 *
 * 読み込みは部分ごとに成否を持つ。**1 つ落ちてもページ全体を白画面にしない**が、
 * 落ちた部分を空配列に畳むこともしない。「0 件」と「読めていない」は別の事実で、
 * 混ぜると未検査が「指摘なし」に化ける（lessons L-015）。
 *
 * TODO(Architect): `project-links.ts` の `ProjectSection` に `render` を足し、
 * `PROJECT_SECTIONS` の末尾（タイムラインの次）に載せてほしい。
 * そうすれば他の画面からここへ来られるようになり、下の戻り導線も
 * `<ProjectNav projectId={...} current="render" />` に置き換えられる。
 */

export const dynamic = 'force-dynamic'

type RenderPageProps = {
  readonly params: Promise<{ readonly id: string }>
}

type Part<T> = {
  readonly value: T | null
  readonly error: string | null
}

const attempt = async <T,>(label: string, run: () => Promise<T>): Promise<Part<T>> => {
  try {
    return { value: await run(), error: null }
  } catch (error) {
    return { value: null, error: `${label}を読み込めませんでした: ${describeError(error)}` }
  }
}

type Loaded = {
  readonly jobs: Part<readonly WireRenderJob[]>
  readonly issues: Part<readonly TimelineIssueView[]>
  readonly durationSec: number | null
}

const load = async (projectId: ProjectId): Promise<Loaded> => {
  const requester = createRequester(resolveApiBaseUrl())
  const renderApi = createRenderApi(requester)
  const timelineApi = createTimelineApi(requester)

  const [jobs, issues, document] = await Promise.all([
    attempt('書き出しの履歴', () => renderApi.listRenderJobs(projectId)),
    // 検証はサーバの validateTimeline が唯一の正。画面に同じ規則を置かない（lessons L-016）。
    attempt('投入前の検査結果', () => timelineApi.getTimelineIssues(projectId)),
    attempt('TimelineDocument', () => timelineApi.getTimelineDocument(projectId)),
  ])

  return { jobs, issues, durationSec: document.value?.durationSec ?? null }
}

const Shell = ({ children }: { readonly children: React.ReactNode }) => (
  <main>
    <PageHeader title="書き出し" />
    {children}
  </main>
)

const RenderPage = async ({ params }: RenderPageProps) => {
  const { id } = await params
  const projectId = ProjectId.safeParse(id)

  if (!projectId.success) {
    return (
      <Shell>
        <ErrorPanel
          title="プロジェクト ID が不正です"
          message={`URL の ID が ULID ではありません: ${id}`}
          hint="プロジェクト一覧から辿り直してください。"
          actions={[{ href: '/', label: 'プロジェクト一覧へ戻る' }]}
        />
      </Shell>
    )
  }

  const project = await attempt('プロジェクト', () => createApiClient().getProject(projectId.data))

  if (project.error !== null) {
    return (
      <Shell>
        <ErrorPanel
          title="読み込めませんでした"
          message={project.error}
          hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
          actions={[{ href: '/', label: 'プロジェクト一覧へ戻る' }]}
        />
      </Shell>
    )
  }

  if (project.value === null) {
    return (
      <Shell>
        <ErrorPanel
          title="プロジェクトが見つかりません"
          message={`ID ${projectId.data} のプロジェクトはありません。`}
          hint="プロジェクト一覧から辿り直してください。"
          actions={[{ href: '/', label: 'プロジェクト一覧へ戻る' }]}
        />
      </Shell>
    )
  }

  const loaded = await load(projectId.data)
  const timelineHref = projectSectionHref(projectId.data, 'timeline')

  return (
    <main>
      <PageHeader
        title="書き出し"
        description={`${project.value.name} のタイムライン全体を 1 本の動画にします。`}
        action={
          <nav aria-label="プロジェクトの画面" className="flex flex-wrap items-center gap-3">
            <Link href="/" className="text-sm text-slate-600 underline hover:text-slate-900">
              プロジェクト一覧
            </Link>
            <Link href={timelineHref} className="text-sm text-slate-600 underline hover:text-slate-900">
              タイムライン
            </Link>
          </nav>
        }
      />

      <div className="flex flex-col gap-6">
        <RenderPanel
          projectId={projectId.data}
          initialJobs={loaded.jobs.value}
          jobsError={loaded.jobs.error}
          blockingIssueCount={
            loaded.issues.value === null
              ? null
              : loaded.issues.value.filter((issue) => issue.severity === 'error').length
          }
          timelineDurationSec={loaded.durationSec}
        />

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-slate-900">投入前の検査</h2>
          {/* 判定はサーバの検査結果をそのまま出す。タイムライン画面と同じ部品を使う。 */}
          <TimelineIssuePanel issues={loaded.issues.value} projectId={projectId.data} />
          {loaded.issues.error !== null && (
            <p role="alert" className="text-sm text-red-800">
              {loaded.issues.error}
            </p>
          )}
          <p className="text-sm">
            <Link href={timelineHref} className="text-slate-700 underline hover:text-slate-950">
              タイムラインで直す
            </Link>
          </p>
        </section>
      </div>
    </main>
  )
}

export default RenderPage
