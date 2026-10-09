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
import { resolveApiBaseUrl, type ApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createServerApiClient, redirectIfUnauthenticated } from '@/lib/server-api-client'
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
    redirectIfUnauthenticated(error)
    return { value: null, error: `${label}を読み込めませんでした: ${describeError(error)}` }
  }
}

const BACK = Object.freeze([Object.freeze({ href: '/', label: 'プロジェクト一覧へ' })])

const Blocked = ({
  title,
  message,
  hint,
  detail,
}: {
  title: string
  message: string
  hint: string
  detail?: string
}) => (
  <main className="relative h-full overflow-auto p-6">
    <ErrorPanel title={title} message={message} hint={hint} actions={BACK} {...(detail === undefined ? {} : { detail })} />
  </main>
)

type Music = {
  readonly track: MusicTrack | null
  readonly analysis: WireMusicAnalysis | null
}

/** 割り当てに使う楽曲は domain の `pickMasterTrack` だけが決める（lessons L-016）。 */
const loadMusic = async (api: ApiClient, projectId: ProjectId): Promise<Music> => {
  const tracks: readonly MusicTrack[] = await api.listMusicTracks(projectId)
  const track = pickMasterTrack(tracks)
  return { track, analysis: track === null ? null : await api.getAnalysis(track.id) }
}

const loadLocations = async (api: ApiClient, project: Project): Promise<readonly Location[]> =>
  api.listLocations(project.id)

const WorkbenchPage = async ({ params, searchParams }: WorkbenchPageProps) => {
  const [{ id }, rawQuery] = await Promise.all([params, searchParams])
  const projectId = ProjectId.safeParse(id)

  if (!projectId.success) {
    return (
      <Blocked
        title="このページのアドレスが正しくありません"
        message="プロジェクトを開けませんでした。"
        hint="プロジェクト一覧から辿り直してください。"
        detail={`アドレスの ID: ${id}`}
      />
    )
  }

  const api = await createServerApiClient()
  const project = await attempt('プロジェクト', () => api.getProject(projectId.data))
  if (project.error !== null) {
    return (
      <Blocked
        title="プロジェクトを読み込めませんでした"
        message={project.error}
        hint="サーバが動いているか確かめてください。"
        detail={`サーバの場所: ${resolveApiBaseUrl()}`}
      />
    )
  }
  // 「無い」を「空」に畳まない。Shot 0 件のワークベンチと見分けがつかなくなる。
  if (project.value === null) {
    return (
      <Blocked
        title="プロジェクトが見つかりません"
        message="このプロジェクトはありません。"
        hint="アドレスが古いか、すでに削除された可能性があります。"
        detail={`アドレスの ID: ${projectId.data}`}
      />
    )
  }

  const loadedProject = project.value
  const [shots, music, sequences, locations] = await Promise.all([
    attempt<readonly Shot[]>('Shot', () => api.listShots(projectId.data)),
    attempt('楽曲と解析', () => loadMusic(api, projectId.data)),
    attempt<readonly Sequence[]>('シーケンス', () => api.listSequences(projectId.data)),
    attempt('ロケーション', () => loadLocations(api, loadedProject)),
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
