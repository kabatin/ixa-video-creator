import { ProjectId, type Shot } from '@ixa/domain'
import Link from 'next/link'
import { ProjectNav } from '@/components/project-nav'
import { EmptyState } from '@/components/empty-state'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { ShotTable } from '@/components/shot-table'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { newShotHref } from '@/lib/shot-links'

export const dynamic = 'force-dynamic'

type ShotsPageProps = {
  readonly params: Promise<{ readonly id: string }>
}

type LoadResult =
  | { readonly ok: true; readonly shots: readonly Shot[] }
  | { readonly ok: false; readonly message: string }

/** API 障害でページを落とさない。失敗は必ず表示可能な値へ畳む。 */
const loadShots = async (projectId: ProjectId): Promise<LoadResult> => {
  try {
    return { ok: true, shots: await createApiClient().listShots(projectId) }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}

const ShotsPage = async ({ params }: ShotsPageProps) => {
  const { id } = await params
  const projectId = ProjectId.safeParse(id)

  if (!projectId.success) {
    return (
      <main>
        <PageHeader title="Shot 一覧" />
        <ErrorPanel
          title="プロジェクト ID が不正です"
          message={`URL の ID が ULID ではありません: ${id}`}
          hint="プロジェクト一覧から辿り直してください。"
        />
      </main>
    )
  }

  const result = await loadShots(projectId.data)

  return (
    <main>
      <PageHeader
        title="Shot 一覧"
        description="Shot がタイムライン上の位置と生成仕様を所有します。"
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
      {!result.ok ? (
        <ErrorPanel
          title="Shot を読み込めませんでした"
          message={result.message}
          hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
        />
      ) : result.shots.length === 0 ? (
        <EmptyState
          message="Shot がありません"
          actionHref={newShotHref(projectId.data)}
          actionLabel="最初の Shot を作成"
        />
      ) : (
        <ShotTable shots={result.shots} />
      )}
    </main>
  )
}

export default ShotsPage
