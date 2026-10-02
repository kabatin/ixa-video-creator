import {
  ProjectId,
  pickMasterTrack,
  type Location,
  type MusicTrack,
  type Project,
  type Sequence,
  type Shot,
} from '@ixa/domain'
import { ErrorPanel } from '@/components/error-panel'
import { ProjectWorkbench } from '@/components/workbench/project-workbench'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { parseWorkbenchQuery } from '@/lib/workbench-url'

/**
 * Project ワークベンチ（UI-WORKBENCH §7.3 / ADR-0021）。
 *
 * **共通の材料だけを一度に読む**: project・shots・楽曲（`pickMasterTrack`）・解析・
 * sequences・locations。タイムライン文書・Take・比較・履歴・費用・下書き・ポスターは
 * パネルが自分で取る（裏のタブは mount されないので、開くまで取らない）。
 *
 * **失敗は畳まない**（lessons L-015）。読めなかった部分は `loadErrors` として
 * ステータスバーに出し、読めた部分でワークベンチを開く。
 * ただし Project そのものが無い・読めないときは開きようが無いので、ここで止める。
 */

export const dynamic = 'force-dynamic'

type WorkbenchPageProps = {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}

type Part<T> = { readonly value: T | null; readonly error: string | null }

const attempt = async <T,>(label: string, run: () => Promise<T>): Promise<Part<T>> => {
  try {
    return { value: await run(), error: null }
  } catch (error) {
    return { value: null, error: `${label}を読み込めませんでした: ${describeError(error)}` }
  }
}

const BACK = Object.freeze([Object.freeze({ href: '/', label: 'プロジェクト一覧へ' })])

const Blocked = ({ title, message, hint }: { title: string; message: string; hint: string }) => (
  <main className="relative h-full overflow-auto p-6">
    <ErrorPanel title={title} message={message} hint={hint} actions={BACK} />
  </main>
)

type Music = {
  readonly track: MusicTrack | null
  readonly analysis: WireMusicAnalysis | null
}

/** 割り当てに使う楽曲は domain の `pickMasterTrack` だけが決める（lessons L-016）。 */
const loadMusic = async (projectId: ProjectId): Promise<Music> => {
  const api = createApiClient()
  const tracks: readonly MusicTrack[] = await api.listMusicTracks(projectId)
  const track = pickMasterTrack(tracks)
  return { track, analysis: track === null ? null : await api.getAnalysis(track.id) }
}

const loadLocations = async (project: Project): Promise<readonly Location[]> =>
  createApiClient().listLocations(project.id)

const WorkbenchPage = async ({ params, searchParams }: WorkbenchPageProps) => {
  const [{ id }, rawQuery] = await Promise.all([params, searchParams])
  const projectId = ProjectId.safeParse(id)

  if (!projectId.success) {
    return (
      <Blocked
        title="プロジェクト ID が不正です"
        message={`URL の ID が ULID ではありません: ${id}`}
        hint="プロジェクト一覧から辿り直してください。"
      />
    )
  }

  const project = await attempt('プロジェクト', () => createApiClient().getProject(projectId.data))
  if (project.error !== null) {
    return (
      <Blocked
        title="プロジェクトを読み込めませんでした"
        message={project.error}
        hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
      />
    )
  }
  // 「無い」を「空」に畳まない。Shot 0 件のワークベンチと見分けがつかなくなる。
  if (project.value === null) {
    return (
      <Blocked
        title="プロジェクトが見つかりません"
        message={`ID ${projectId.data} のプロジェクトはありません。`}
        hint="URL が古いか、すでに削除された可能性があります。"
      />
    )
  }

  const loadedProject = project.value
  const [shots, music, sequences, locations] = await Promise.all([
    attempt<readonly Shot[]>('Shot', () => createApiClient().listShots(projectId.data)),
    attempt('楽曲と解析', () => loadMusic(projectId.data)),
    attempt<readonly Sequence[]>('シーケンス', () =>
      createApiClient().listSequences(projectId.data),
    ),
    attempt('ロケーション', () => loadLocations(loadedProject)),
  ])

  const loadErrors = [shots.error, music.error, sequences.error, locations.error].filter(
    (message): message is string => message !== null,
  )

  return (
    <ProjectWorkbench
      project={loadedProject}
      initialShots={shots.value}
      track={music.value?.track ?? null}
      analysis={music.value?.analysis ?? null}
      musicLoaded={music.error === null}
      sequences={sequences.value ?? []}
      locations={locations.value}
      loadErrors={loadErrors}
      query={parseWorkbenchQuery(rawQuery)}
    />
  )
}

export default WorkbenchPage
