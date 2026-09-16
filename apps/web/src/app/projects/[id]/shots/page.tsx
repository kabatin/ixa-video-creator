import { ProjectId, type Project, type Shot } from '@ixa/domain'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ProjectNav } from '@/components/project-nav'
import { EmptyState, describeViewState } from '@/components/empty-state'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { ShotTable } from '@/components/shot-table'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { projectSectionHref } from '@/lib/project-links'
import { newShotHref } from '@/lib/shot-links'

/**
 * Shot 一覧（P55-6）。
 *
 * **「Project が無い」と「Shot が 0 件」を畳まない。** API は存在しない Project に対しても
 * `GET /projects/{id}/shots` で `200 []` を返す。Project 自体を取らずに一覧だけ読むと、
 * 存在しない Project が「Shot がありません」に化け、利用者は「Project はあるが
 * Shot が無い」と読み違える（lessons L-015）。タイムライン画面と同じく、
 * **先に Project の存在を確かめてから** Shot を読む。
 */

export const dynamic = 'force-dynamic'

const PROJECT_LIST_HREF = '/'

type ShotsPageProps = {
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

const backToProjects = Object.freeze([
  Object.freeze({ href: PROJECT_LIST_HREF, label: 'プロジェクト一覧へ' }),
])

const Shell = ({ children }: { readonly children: ReactNode }) => (
  <main>
    <PageHeader title="Shot 一覧" />
    {children}
  </main>
)

const ShotsBody = ({
  projectId,
  shots,
}: {
  readonly projectId: ProjectId
  readonly shots: Part<readonly Shot[]>
}) => {
  if (shots.error !== null) {
    const state = describeViewState('unreadable', 'Shot')
    return (
      <ErrorPanel
        title={state.title}
        message={shots.error}
        hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
        actions={backToProjects}
      />
    )
  }

  if (shots.value === null || shots.value.length === 0) {
    const state = describeViewState('empty', 'Shot')
    return (
      <EmptyState
        message={state.title}
        hint="ストーリーボードから歌詞や構成をまとめて Shot にするのが本筋です。1 件だけ作ることもできます。"
        actionHref={projectSectionHref(projectId, 'storyboard')}
        actionLabel="ストーリーボードから作る"
        secondaryHref={newShotHref(projectId)}
        secondaryLabel="Shot を 1 件だけ作る"
      />
    )
  }

  return <ShotTable shots={shots.value} />
}

const ShotsPage = async ({ params }: ShotsPageProps) => {
  const { id } = await params
  const projectId = ProjectId.safeParse(id)

  if (!projectId.success) {
    return (
      <Shell>
        <ErrorPanel
          title="プロジェクト ID が不正です"
          message={`URL の ID が ULID ではありません: ${id}`}
          hint="プロジェクト一覧から辿り直してください。"
          actions={backToProjects}
        />
      </Shell>
    )
  }

  const project: Part<Project | null> = await attempt('プロジェクト', () =>
    createApiClient().getProject(projectId.data),
  )

  if (project.error !== null) {
    const state = describeViewState('unreadable', 'プロジェクト')
    return (
      <Shell>
        <ErrorPanel
          title={state.title}
          message={project.error}
          hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
          actions={backToProjects}
        />
      </Shell>
    )
  }

  // 「無い」を「空」に畳まない。ここで止めないと Shot 0 件と見分けがつかなくなる。
  if (project.value === null) {
    const state = describeViewState('missing', 'プロジェクト')
    return (
      <Shell>
        <ErrorPanel
          title={state.title}
          message={`ID ${projectId.data} のプロジェクトはありません。`}
          hint={state.hint}
          actions={backToProjects}
        />
      </Shell>
    )
  }

  const shots = await attempt('Shot', () => createApiClient().listShots(projectId.data))

  return (
    <main>
      <PageHeader
        title="Shot 一覧"
        description={`${project.value.name} の Shot がタイムライン上の位置と生成仕様を所有します。`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <ProjectNav projectId={projectId.data} current="shots" />
            <Link
              href={newShotHref(projectId.data)}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              新規 Shot
            </Link>
          </div>
        }
      />
      <ShotsBody projectId={projectId.data} shots={shots} />
    </main>
  )
}

export default ShotsPage
