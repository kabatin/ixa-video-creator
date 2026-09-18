import {
  pickMasterTrack,
  type MusicTrack,
  type ProjectId,
  type ShotId,
  type TimelineClip,
  type Transition,
} from '@ixa/domain'
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
 * タイムラインのパネルが自分で取る材料（UI-WORKBENCH §7.3）。旧タイムライン画面の読み込みを移した。
 *
 * 読み込みは部分ごとに成否を持つ。**1 つ落ちても全体を白画面にしない**が、
 * 落ちた部分を空配列に畳むこともしない。「0 件」と「読めていない」は別の事実で、
 * 混ぜると検証が「指摘なし」に化ける（lessons L-015）。
 */

export type Part<T> = {
  readonly value: T | null
  readonly error: string | null
}

const attempt = async <T>(label: string, run: () => Promise<T>): Promise<Part<T>> => {
  try {
    return { value: await run(), error: null }
  } catch (error) {
    return { value: null, error: `${label}を読み込めませんでした: ${describeError(error)}` }
  }
}

export type TimelineMaterials = {
  readonly transitions: Part<readonly Transition[]>
  readonly clips: Part<readonly TimelineClip[]>
  /** モニターの入力。プレビューと書き出しは同じ物を見る。 */
  readonly document: Part<WireTimelineDocument>
  readonly issues: Part<readonly WireTimelineIssue[]>
  readonly beatSource: BeatSource
  /** 拍とのズレ。判定はサーバの 1 箇所が持つ（画面で数え直さない）。 */
  readonly beatAlignment: Part<WireTimelineBeatAlignment>
}

/**
 * 吸着に使う楽曲の解析を読む。**どの楽曲を選ぶかは domain の `pickMasterTrack`**（L-016）。
 * 「楽曲が無い」「解析がまだ」「読めない」を畳まずに返す。
 */
export const loadBeatSource = async (projectId: ProjectId): Promise<BeatSource> => {
  try {
    const api = createApiClient()
    const tracks: readonly MusicTrack[] = await api.listMusicTracks(projectId)
    const track = pickMasterTrack(tracks)
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

/** モニターの入力だけ。プレビューのパネルが使う。 */
export const loadTimelineDocument = (projectId: ProjectId): Promise<Part<WireTimelineDocument>> =>
  attempt('TimelineDocument', () =>
    createTimelineApi(createRequester(resolveApiBaseUrl())).getTimelineDocument(projectId),
  )

export const loadTimelineMaterials = async (projectId: ProjectId): Promise<TimelineMaterials> => {
  const requester = createRequester(resolveApiBaseUrl())
  const timelineApi = createTimelineApi(requester)
  const beatAlignmentApi = createBeatAlignmentApi(requester)

  const [transitions, clips, document, issues, beatSource, beatAlignment] = await Promise.all([
    attempt('Transition', () => timelineApi.listTransitions(projectId)),
    attempt('クリップ', () => timelineApi.listClips(projectId)),
    attempt('TimelineDocument', () => timelineApi.getTimelineDocument(projectId)),
    // 検証はサーバの validateTimeline が唯一の正。画面に同じ規則を置かない。
    attempt('検証結果', () => timelineApi.getTimelineIssues(projectId)),
    loadBeatSource(projectId),
    attempt('拍とのズレ', () => beatAlignmentApi.getTimelineBeatAlignment(projectId)),
  ])

  return { transitions, clips, document, issues, beatSource, beatAlignment }
}

/** 採用 Take を解決できた Shot。サーバの組み立て結果が唯一の正。 */
export const renderedShotIdsOf = (materials: TimelineMaterials): readonly ShotId[] | null =>
  materials.document.value === null
    ? null
    : materials.document.value.video1.map((entry) => entry.shotId)

/** 読めなかった部分の理由。**黙って色なし・指摘なしに畳まない**（L-015）。 */
export const timelineLoadErrors = (materials: TimelineMaterials): readonly string[] =>
  [
    materials.transitions.error,
    materials.clips.error,
    materials.document.error,
    materials.beatAlignment.error,
  ].filter((message): message is string => message !== null)
