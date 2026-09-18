import { ProjectId, orderBetween, shotEndSec, type Location, type Shot } from '@ixa/domain'
import Link from 'next/link'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { ShotForm } from '@/components/shot-form'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { shotListHref } from '@/lib/shot-links'
import { resolveWorkspaceId } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

type NewShotPageProps = {
  readonly params: Promise<{ readonly id: string }>
}

type LoadResult =
  | { readonly ok: true; readonly shots: readonly Shot[] }
  | { readonly ok: false; readonly message: string }

const loadShots = async (projectId: ProjectId): Promise<LoadResult> => {
  try {
    return { ok: true, shots: await createApiClient().listShots(projectId) }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}

type LocationsResult =
  | { readonly ok: true; readonly locations: readonly Location[] }
  | { readonly ok: false; readonly message: string }

/**
 * ロケーションは Shot 作成の必須条件ではない。
 * 読み込みに失敗しても作成自体は続けられるよう、失敗を画面上のメッセージへ畳む。
 */
const loadLocations = async (): Promise<LocationsResult> => {
  const workspace = resolveWorkspaceId()
  if (!workspace.ok) return { ok: false, message: workspace.reason }

  try {
    return { ok: true, locations: await createApiClient().listLocations(workspace.workspaceId) }
  } catch (error) {
    return { ok: false, message: describeError(error) }
  }
}

/** 末尾へ追加する。order は 1000 刻みで採番する（ARCHITECTURE.md §19）。 */
const nextOrderOf = (shots: readonly Shot[]): number =>
  orderBetween(
    shots.reduce<number | null>((max, s) => (max === null || s.order > max ? s.order : max), null),
    null,
  )

/** 既定の開始秒は最後の Shot の終端。重ならない位置から書き始められるようにする。 */
const nextStartSecOf = (shots: readonly Shot[]): number =>
  shots.reduce<number>((end, s) => Math.max(end, shotEndSec(s)), 0)

const NewShotPage = async ({ params }: NewShotPageProps) => {
  const { id } = await params
  const projectId = ProjectId.safeParse(id)

  if (!projectId.success) {
    return (
      <main className="mx-auto w-full max-w-3xl">
        <PageHeader title="新規 Shot" />
        <ErrorPanel
          title="プロジェクト ID が不正です"
          message={`URL の ID が ULID ではありません: ${id}`}
          hint="プロジェクト一覧から辿り直してください。"
        />
      </main>
    )
  }

  const [result, locations] = await Promise.all([loadShots(projectId.data), loadLocations()])

  return (
    <main className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="新規 Shot"
        description="カメラ指定は生成プロンプトへそのまま反映されます。"
        action={
          <Link
            href={shotListHref(projectId.data)}
            className="text-sm text-muted underline hover:text-text"
          >
            一覧へ戻る
          </Link>
        }
      />
      {result.ok ? (
        <ShotForm
          projectId={projectId.data}
          nextOrder={nextOrderOf(result.shots)}
          defaultStartSec={nextStartSecOf(result.shots)}
          locations={locations.ok ? locations.locations : []}
          locationsError={locations.ok ? undefined : locations.message}
        />
      ) : (
        <ErrorPanel
          title="既存の Shot を読み込めませんでした"
          message={result.message}
          hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。order を採番できないため作成を開始できません。`}
        />
      )}
    </main>
  )
}

export default NewShotPage
