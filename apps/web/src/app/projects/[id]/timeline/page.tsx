import {
  ProjectId,
  pickMasterTrack,
  type Shot,
  type ShotId,
  type TimelineClip,
  type Transition,
} from '@ixa/domain'
import { ProjectNav } from '@/components/project-nav'
import { ErrorPanel } from '@/components/error-panel'
import { PageHeader } from '@/components/page-header'
import { TimelineEditor } from '@/components/timeline-editor'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createBeatAlignmentApi, type WireTimelineBeatAlignment } from '@/lib/beat-alignment-view'
import { createRequester } from '@/lib/requester'
import {
  createTimelineApi,
  type WireTimelineDocument,
  type WireTimelineIssue,
} from '@/lib/timeline-api'
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
  /** モニターの入力。プレビューと書き出しは同じ物を見る。 */
  readonly document: Part<WireTimelineDocument>
  readonly issues: Part<readonly WireTimelineIssue[]>
  readonly beatSource: BeatSource
  /** 拍とのズレ。判定はサーバの 1 箇所が持つ（画面で数え直さない）。 */
  readonly beatAlignment: Part<WireTimelineBeatAlignment>
}

/**
 * 吸着に使う楽曲の解析を読む。**どの楽曲を選ぶかは domain の `pickMasterTrack`。**
 * ミュージックビデオでは尺を決めるのがマスター音源なので、そこを既定にする
 * （ストーリーボード画面・拍とのズレの口と同じ選び方）。
 */
const loadBeatSource = async (projectId: ProjectId): Promise<BeatSource> => {
  try {
    const api = createApiClient()
    // 選び方は domain の `pickMasterTrack` だけが持つ。サーバ側（拍とのズレの口）も
    // 同じ関数を呼ぶので、**2 つの経路が違う曲の拍を使うことがない**（L-016）。
    const track = pickMasterTrack(await api.listMusicTracks(projectId))
    if (track === null) return { state: 'no_track' }

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

  const beatAlignmentApi = createBeatAlignmentApi(createRequester(resolveApiBaseUrl()))

  const [shots, transitions, clips, document, issues, beatSource, beatAlignment] =
    await Promise.all([
      attempt('Shot', () => api.listShots(projectId)),
      attempt('Transition', () => timelineApi.listTransitions(projectId)),
      attempt('クリップ', () => timelineApi.listClips(projectId)),
      attempt('TimelineDocument', () => timelineApi.getTimelineDocument(projectId)),
      // 検証はサーバの validateTimeline が唯一の正。画面に同じ規則を置かない。
      attempt('検証結果', () => timelineApi.getTimelineIssues(projectId)),
      // 吸着候補のビート。失敗しても画面は出すが、失敗した事実は値として残す。
      loadBeatSource(projectId),
      // 拍とのズレ。しきい値も「解析が無い」の扱いもサーバ側の 1 箇所が持つ。
      attempt('拍とのズレ', () => beatAlignmentApi.getTimelineBeatAlignment(projectId)),
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
    document,
    issues,
    beatSource,
    beatAlignment,
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
    // **読めなかったことを黙って色なしに畳まない。** 色が付かない理由が
    // 「拍に乗っている」に見えてしまう（lessons L-015）。
    loaded.beatAlignment.error,
  ].filter((message): message is string => message !== null)

  return (
    <main>
      <PageHeader
        title="タイムライン"
        description={`${project.value.name} の Shot・Transition・クリップを時間軸で見て直します。`}
        action={<ProjectNav projectId={projectId.data} current="timeline" />}
      />

      <TimelineEditor
        projectId={projectId.data}
        shots={loaded.shots.value}
        initialTransitions={loaded.transitions.value}
        initialClips={loaded.clips.value}
        renderedShotIds={loaded.renderedShotIds.value}
        documentDurationSec={loaded.durationSec}
        initialDocument={loaded.document.value}
        initialIssues={loaded.issues.value}
        beatSource={loaded.beatSource}
        beatAlignment={loaded.beatAlignment.value}
        loadErrors={loadErrors}
      />
    </main>
  )
}

export default TimelinePage
