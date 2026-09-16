import { ProjectId, type Shot, type ShotId, type TimelineClip, type Transition } from '@ixa/domain'
import Link from 'next/link'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { TimelineEditor } from '@/components/timeline-editor'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createRequester } from '@/lib/requester'
import { createTimelineApi, type WireTimelineIssue } from '@/lib/timeline-api'
import { shotListHref } from '@/lib/shot-links'
import type { BeatSource } from '@/lib/timeline-snap'

/**
 * タイムライン編集画面（P5-4）。
 *
 * 読み込みは部分ごとに成否を持つ。**1 つ落ちてもページ全体を白画面にしない**が、
 * 落ちた部分を空配列に畳むこともしない。「0 件」と「読めていない」は別の事実で、
 * 混ぜると検証が「指摘なし」に化ける（lessons L-015）。
 *
 * ビート吸着の候補は楽曲解析から来る。解析が無い Project でも画面は出すが、
 * **「ビート候補が無い」ことを黙って「吸着しない」に畳まない。**
 * 楽曲が無いのか・解析がまだなのか・読めていないのかを区別して渡す。
 */

export const dynamic = 'force-dynamic'

type TimelinePageProps = {
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
  readonly shots: Part<readonly Shot[]>
  readonly transitions: Part<readonly Transition[]>
  readonly clips: Part<readonly TimelineClip[]>
  readonly renderedShotIds: Part<readonly ShotId[]>
  readonly durationSec: number | null
  readonly issues: Part<readonly WireTimelineIssue[]>
  readonly beatSource: BeatSource
}

/**
 * 吸着に使う楽曲を選ぶ。マスター音源があればそれ、無ければ先頭。
 * ミュージックビデオでは**尺を決めるのはマスター音源**なので、そこを既定にする
 * （ストーリーボード画面と同じ選び方）。
 */
const loadBeatSource = async (projectId: ProjectId): Promise<BeatSource> => {
  try {
    const api = createApiClient()
    const tracks = await api.listMusicTracks(projectId)
    const track = tracks.find((candidate) => candidate.isMaster) ?? tracks[0]
    if (track === undefined) return { state: 'no_track' }

    const analysis = await api.getAnalysis(track.id)
    if (analysis === null) return { state: 'no_analysis', trackTitle: track.title }
    if (analysis.beats.length === 0) return { state: 'no_beats', trackTitle: track.title }

    return {
      state: 'available',
      trackTitle: track.title,
      beats: analysis.beats,
      sections: analysis.sections,
      drops: analysis.drops,
    }
  } catch (error) {
    return { state: 'unreadable', reason: describeError(error) }
  }
}

const load = async (projectId: ProjectId): Promise<Loaded> => {
  const api = createApiClient()
  const timelineApi = createTimelineApi(createRequester(resolveApiBaseUrl()))

  const [shots, transitions, clips, document, issues, beatSource] = await Promise.all([
    attempt('Shot', () => api.listShots(projectId)),
    attempt('Transition', () => timelineApi.listTransitions(projectId)),
    attempt('クリップ', () => timelineApi.listClips(projectId)),
    attempt('TimelineDocument', () => timelineApi.getTimelineDocument(projectId)),
    // 検証はサーバの validateTimeline が唯一の正。画面に同じ規則を置かない。
    attempt('検証結果', () => timelineApi.getTimelineIssues(projectId)),
    // 吸着候補のビート。失敗しても画面は出すが、失敗した事実は値として残す。
    loadBeatSource(projectId),
  ])

  return {
    shots,
    transitions,
    clips,
    // 採用 Take を解決できた Shot はサーバの組み立て結果が唯一の正。画面で判定し直さない。
    renderedShotIds: {
      value: document.value === null ? null : document.value.video1.map((entry) => entry.shotId),
      error: document.error,
    },
    durationSec: document.value?.durationSec ?? null,
    issues,
    beatSource,
  }
}

const TimelinePage = async ({ params }: TimelinePageProps) => {
  const { id } = await params
  const projectId = ProjectId.safeParse(id)

  if (!projectId.success) {
    return (
      <main>
        <PageHeader title="タイムライン" />
        <ErrorPanel
          title="プロジェクト ID が不正です"
          message={`URL の ID が ULID ではありません: ${id}`}
          hint="プロジェクト一覧から辿り直してください。"
        />
      </main>
    )
  }

  const project = await attempt('プロジェクト', () => createApiClient().getProject(projectId.data))

  if (project.error !== null) {
    return (
      <main>
        <PageHeader title="タイムライン" />
        <ErrorPanel
          title="読み込めませんでした"
          message={project.error}
          hint={`API (${resolveApiBaseUrl()}) が起動しているか確認してください。`}
        />
      </main>
    )
  }

  if (project.value === null) {
    return (
      <main>
        <PageHeader title="タイムライン" />
        <ErrorPanel
          title="プロジェクトが見つかりません"
          message={`ID ${projectId.data} のプロジェクトはありません。`}
          hint="プロジェクト一覧から辿り直してください。"
        />
      </main>
    )
  }

  const loaded = await load(projectId.data)
  const loadErrors = [
    loaded.shots.error,
    loaded.transitions.error,
    loaded.clips.error,
    loaded.renderedShotIds.error,
  ].filter((message): message is string => message !== null)

  return (
    <main>
      <PageHeader
        title="タイムライン"
        description={`${project.value.name} の Shot・Transition・クリップを時間軸で見て直します。`}
        action={
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-slate-600 underline hover:text-slate-900">
              プロジェクト一覧
            </Link>
            <Link
              href={shotListHref(projectId.data)}
              className="text-sm text-slate-600 underline hover:text-slate-900"
            >
              Shot 一覧
            </Link>
          </div>
        }
      />

      <TimelineEditor
        projectId={projectId.data}
        shots={loaded.shots.value}
        initialTransitions={loaded.transitions.value}
        initialClips={loaded.clips.value}
        renderedShotIds={loaded.renderedShotIds.value}
        documentDurationSec={loaded.durationSec}
        initialIssues={loaded.issues.value}
        beatSource={loaded.beatSource}
        loadErrors={loadErrors}
      />
    </main>
  )
}

export default TimelinePage
