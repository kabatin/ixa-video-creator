import { ProjectId, type MusicTrack, type Project } from '@ixa/domain'
import { ErrorPanel } from '@/components/error-panel'
import { MusicPanel } from '@/components/music-panel'
import { PageHeader } from '@/components/page-header'
import { ProjectNav } from '@/components/project-nav'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

const TITLE = '楽曲'

type MusicPageProps = {
  readonly params: Promise<{ readonly id: string }>
}

type Loaded = {
  readonly project: Project
  readonly tracks: readonly MusicTrack[]
}

type LoadResult =
  | { readonly ok: true; readonly loaded: Loaded }
  | { readonly ok: false; readonly title: string; readonly message: string }

/**
 * Workspace は env ではなく Project から取る。
 * アップロードする音源はこの Project の Workspace に属するため、正は Project 側にある。
 */
const load = async (projectId: ProjectId): Promise<LoadResult> => {
  try {
    const api = createApiClient()
    const project = await api.getProject(projectId)
    if (project === null) {
      return {
        ok: false,
        title: 'プロジェクトが見つかりません',
        message: `ID ${projectId} のプロジェクトは存在しません。`,
      }
    }
    return { ok: true, loaded: { project, tracks: await api.listMusicTracks(projectId) } }
  } catch (error) {
    return { ok: false, title: '読み込めませんでした', message: describeError(error) }
  }
}

const MusicPage = async ({ params }: MusicPageProps) => {
  const { id } = await params
  const projectId = ProjectId.safeParse(id)

  if (!projectId.success) {
    return (
      <main>
        <PageHeader title={TITLE} />
        <ErrorPanel
          title="プロジェクト ID が不正です"
          message={`URL の ID が ULID ではありません: ${id}`}
          hint="プロジェクト一覧から辿り直してください。"
        />
      </main>
    )
  }

  const result = await load(projectId.data)

  return (
    <main>
      <PageHeader
        title={TITLE}
        description="音源をアップロードして楽曲として登録し、ビートとセクションを解析します。ここが制作の起点です。"
        action={<ProjectNav projectId={projectId.data} current="music" />}
      />

      {result.ok ? (
        <MusicPanel
          projectId={projectId.data}
          workspaceId={result.loaded.project.workspaceId}
          initialTracks={result.loaded.tracks}
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

export default MusicPage
