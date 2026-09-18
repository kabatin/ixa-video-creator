import { ProjectId, ShotId, type Location, type Shot, type Take } from '@ixa/domain'
import Link from 'next/link'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { ShotWorkbench } from '@/components/shot-workbench'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { PROJECT_ID_PARAM, shotListHref } from '@/lib/shot-links'
import { resolveWorkspaceId } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

type ShotPageProps = {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}

type LoadResult =
  | { readonly ok: true; readonly shot: Shot; readonly takes: readonly Take[] }
  | { readonly ok: false; readonly title: string; readonly message: string }

const singleParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '')

/**
 * API に `GET /shots/{id}` が無いため、projectId をクエリで受け取り一覧から引く。
 * 失敗は必ず表示可能な値へ畳み、ページを落とさない。
 */
const loadShot = async (projectId: ProjectId, shotId: ShotId): Promise<LoadResult> => {
  const client = createApiClient()
  try {
    const [shots, takes] = await Promise.all([
      client.listShots(projectId),
      client.listTakes(shotId),
    ])
    const shot = shots.find((candidate) => candidate.id === shotId)
    if (shot === undefined) {
      return {
        ok: false,
        title: 'Shot が見つかりません',
        message: `このプロジェクトに ${shotId} という Shot はありません。`,
      }
    }
    return { ok: true, shot, takes }
  } catch (error) {
    return {
      ok: false,
      title: 'Shot を読み込めませんでした',
      message: describeError(error),
    }
  }
}

type LocationsResult =
  | { readonly ok: true; readonly locations: readonly Location[] }
  | { readonly ok: false; readonly message: string }

/**
 * ロケーションは Shot 詳細の付帯情報でしかない。
 * 読み込みに失敗しても Take の比較は続けられるよう、失敗を画面上のメッセージへ畳む。
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

const ShotDetailPage = async ({ params, searchParams }: ShotPageProps) => {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const shotId = ShotId.safeParse(id)
  const projectId = ProjectId.safeParse(singleParam(query[PROJECT_ID_PARAM]))

  if (!shotId.success || !projectId.success) {
    return (
      <main>
        <PageHeader title="Shot" />
        <ErrorPanel
          title="URL が不正です"
          message="Shot ID と projectId（クエリ）の両方が ULID である必要があります。"
          hint="Shot 一覧の「Take を見る」から開いてください。"
        />
      </main>
    )
  }

  const [result, locations] = await Promise.all([
    loadShot(projectId.data, shotId.data),
    loadLocations(),
  ])

  return (
    <main>
      <PageHeader
        title="Shot 詳細"
        description="生成した Take を並べて比較し、採用する 1 本を決めます。"
        action={
          <Link
            href={shotListHref(projectId.data)}
            className="text-sm text-muted underline hover:text-text"
          >
            Shot 一覧へ戻る
          </Link>
        }
      />
      {result.ok ? (
        <ShotWorkbench
          shot={result.shot}
          initialTakes={result.takes}
          locations={locations.ok ? locations.locations : []}
          locationsError={locations.ok ? undefined : locations.message}
        />
      ) : (
        <ErrorPanel
          title={result.title}
          message={result.message}
          hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
        />
      )}
    </main>
  )
}

export default ShotDetailPage
