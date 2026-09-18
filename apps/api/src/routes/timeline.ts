import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  MediaAssetRepository, MusicAnalysisRepository, MusicTrackRepository, ProjectRepository,
  ShotRepository, TakeRepository, TimelineClipRepository, TransitionRepository,
} from '@ixa/db'
import {
  BeatAlignment as BeatAlignmentSchema,
  ProjectId as ProjectIdSchema,
  Seconds as SecondsSchema,
  TimelineDocument as TimelineDocumentSchema,
  alignBoundary,
  pickMasterTrack,
  type MediaAsset,
  type MediaAssetId,
  type Project,
  type ProjectId,
  type Shot,
  ShotId as ShotIdSchema,
  type ShotId,
  type TimelineClip,
} from '@ixa/domain'
import { buildTimelineDocument, validateTimeline, type TimelineMusicTrack, type TimelineSource } from '@ixa/timeline'
import type { ObjectStorage } from '@ixa/storage'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * `TimelineDocument` の取得（docs/ARCHITECTURE.md §15 / §18）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * 組み立て自体は `@ixa/timeline` の `buildTimelineDocument` が行う。
 * このファイルの仕事は **DB から素材を集め、メディアを URL に解決すること**だけ。
 */

/**
 * タイムライン内のメディアに発行する署名付き URL の有効期限（秒）。
 * URL は DB に保存せず都度発行する（CLAUDE.md 規約 7）。
 */
export const TIMELINE_SIGNED_URL_EXPIRES_SEC = 3600

/** `RenderableClipContent.kind` が受け付ける種別。font / lut / other は載せられない。 */
const RENDERABLE_KINDS = ['image', 'video', 'audio'] as const
type RenderableKind = (typeof RENDERABLE_KINDS)[number]

const toRenderableKind = (asset: MediaAsset): RenderableKind | undefined =>
  RENDERABLE_KINDS.find((kind) => kind === asset.kind)

export type TimelineRoutesDeps = {
  projects: ProjectRepository
  shots: ShotRepository
  takes: TakeRepository
  transitions: TransitionRepository
  timelineClips: TimelineClipRepository
  musicTracks: MusicTrackRepository
  mediaAssets: MediaAssetRepository
  storage: ObjectStorage
}

/** 解決済みメディア 1 件。署名付き URL は保持するだけで DB へは書かない。 */
type ResolvedMedia = {
  readonly url: string
  readonly kind: RenderableKind
  readonly durationSec: number
}

/**
 * MediaAsset を引いて署名付き URL を発行する。
 *
 * `TimelineSource` の resolver は同期関数なので、**先に全部引いて Map に載せる**。
 * 見つからない・レンダラに載せられない種別のものは載せない（呼び出し側が undefined を見る）。
 */
const resolveMediaAssets = async (
  deps: Pick<TimelineRoutesDeps, 'mediaAssets' | 'storage'>,
  ids: readonly MediaAssetId[],
): Promise<ReadonlyMap<MediaAssetId, ResolvedMedia>> => {
  const unique = [...new Set(ids)]
  const entries = await Promise.all(
    unique.map(async (id): Promise<readonly [MediaAssetId, ResolvedMedia] | null> => {
      const asset = await deps.mediaAssets.findById(id)
      if (asset === null) return null
      const kind = toRenderableKind(asset)
      if (kind === undefined) return null
      const url = await deps.storage.signedGetUrl(
        asset.storageKey,
        TIMELINE_SIGNED_URL_EXPIRES_SEC,
      )
      return [id, { url, kind, durationSec: asset.probe?.durationSec ?? 0 }] as const
    }),
  )
  return new Map(entries.filter((entry): entry is readonly [MediaAssetId, ResolvedMedia] =>
    entry !== null,
  ))
}

/** Shot の採用 Take から `mediaAssetId` を引く。未採用・Take 欠落は載せない。 */
const resolveShotAssets = async (
  takes: TakeRepository,
  shots: readonly Shot[],
): Promise<ReadonlyMap<ShotId, MediaAssetId>> => {
  const entries = await Promise.all(
    shots.map(async (shot): Promise<readonly [ShotId, MediaAssetId] | null> => {
      if (shot.selectedTakeId === null) return null
      const take = await takes.findById(shot.selectedTakeId)
      // 採用 Take が消えていても例外にしない。VIDEO1 から落ちるだけで、
      // validateTimeline が shot_missing_take の warning として拾う。
      if (take === null) return null
      return [shot.id, take.mediaAssetId] as const
    }),
  )
  return new Map(entries.filter((entry): entry is readonly [ShotId, MediaAssetId] =>
    entry !== null,
  ))
}

/** クリップが参照している MediaAssetId を集める。text / motion_graphics は参照しない。 */
const clipMediaAssetIds = (clips: readonly TimelineClip[]): MediaAssetId[] =>
  clips.flatMap((clip) => (clip.content.type === 'media' ? [clip.content.mediaAssetId] : []))

/**
 * プロジェクトの素材一式を DB から読み、`buildTimelineDocument` に渡せる形にする。
 *
 * **`TimelineDocument` の組み立てはここでは行わない。** 純粋関数に任せることで、
 * プレビューとレンダリングが同じコードを通る（ARCHITECTURE.md §15）。
 * renders.ts も同じ入力を使うため export する。
 */
export const loadTimelineSource = async (
  deps: TimelineRoutesDeps,
  project: Project,
): Promise<TimelineSource> => {
  const [shots, transitions, clips, tracks] = await Promise.all([
    deps.shots.findByProject(project.id),
    deps.transitions.findByProject(project.id),
    deps.timelineClips.findByProject(project.id),
    deps.musicTracks.findByProject(project.id),
  ])

  const shotAssetIds = await resolveShotAssets(deps.takes, shots)
  const media = await resolveMediaAssets(deps, [
    ...shotAssetIds.values(),
    ...clipMediaAssetIds(clips),
    ...tracks.map((track) => track.mediaAssetId),
  ])

  const musicTracks: TimelineMusicTrack[] = tracks.flatMap((track) => {
    const resolved = media.get(track.mediaAssetId)
    if (resolved === undefined) return []
    return [
      {
        mediaUrl: resolved.url,
        startSec: track.offsetSec,
        // 音源の尺は MediaAsset の probe が持つ。未解析なら 0（尺に効かせない）。
        durationSec: resolved.durationSec,
        volume: track.volume,
      },
    ]
  })

  return {
    project: { fps: project.fps, resolution: project.resolution },
    shots,
    transitions,
    clips,
    musicTracks,
    resolveShotMedia: (shot) => {
      const assetId = shotAssetIds.get(shot.id)
      return assetId === undefined ? undefined : media.get(assetId)?.url
    },
    resolveClipMedia: (mediaAssetId) => {
      const resolved = media.get(mediaAssetId)
      return resolved === undefined ? undefined : { url: resolved.url, kind: resolved.kind }
    },
  }
}

/** プロジェクトを引き、素材を読んで `TimelineDocument` まで組み立てる。無ければ null。 */
export const loadTimelineDocument = async (deps: TimelineRoutesDeps, projectId: ProjectId) => {
  const project = await deps.projects.findById(projectId)
  if (project === null) return null
  const source = await loadTimelineSource(deps, project)
  return { project, source, document: buildTimelineDocument(source) }
}

export const TimelineDocumentResponse = TimelineDocumentSchema.openapi('TimelineDocument')
export type TimelineDocumentResponse = z.infer<typeof TimelineDocumentResponse>

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const getTimelineRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/timeline',
  tags: ['timeline'],
  summary: 'プレビューとレンダリングの共通入力 TimelineDocument を組み立てて返す',
  request: { params: ProjectParams },
  responses: {
    200: {
      description: 'TimelineDocument',
      content: { 'application/json': { schema: successResponse(TimelineDocumentResponse) } },
    },
    404: errorContent('Project が存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

/**
 * `TimelineIssue`（@ixa/timeline）の DTO。
 * `renders.ts` にも同じ形があるが、OpenAPI の component 名が衝突するため
 * ここでは別名で登録する。**判定そのものは両方とも `validateTimeline` だけが持つ。**
 */
export const TimelineCheckIssue = z
  .object({
    severity: z.enum(['error', 'warning']),
    code: z.string(),
    message: z.string(),
    shotId: ShotIdSchema.optional(),
  })
  .openapi('TimelineCheckIssue')
export type TimelineCheckIssue = z.infer<typeof TimelineCheckIssue>

const getTimelineIssuesRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/timeline/issues',
  tags: ['timeline'],
  summary: 'タイムラインの検証結果（隙間・重なり・未生成など）',
  request: { params: ProjectParams },
  responses: {
    200: {
      description: '検証結果',
      content: { 'application/json': { schema: listResponse(TimelineCheckIssue) } },
    },
    404: errorContent('Project が存在しない'),
    500: errorContent('サーバ内部エラー'),
  },
})

export const timelineRoutes = (deps: TimelineRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(getTimelineRoute, async (c) => {
      const loaded = await loadTimelineDocument(deps, c.req.valid('param').projectId)
      if (loaded === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(loaded.document), 200)
    })
    /**
     * 検証を画面へ出すための口。
     *
     * **画面に同じ規則を書かせない。** 書くと必ずズレて、レンダリングでは
     * 止まるのに画面では合格に見える（またはその逆）状態が生まれる。
     * レンダリング前の検査（renders.ts）と同じ `validateTimeline` を使う。
     */
    .openapi(getTimelineIssuesRoute, async (c) => {
      const loaded = await loadTimelineDocument(deps, c.req.valid('param').projectId)
      if (loaded === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(okList(validateTimeline(loaded.source).map(toCheckIssue)), 200)
    })

const toCheckIssue = (issue: {
  severity: 'error' | 'warning'
  code: string
  message: string
  shotId?: ShotId
}): TimelineCheckIssue =>
  issue.shotId === undefined
    ? { severity: issue.severity, code: issue.code, message: issue.message }
    : { severity: issue.severity, code: issue.code, message: issue.message, shotId: issue.shotId }

/**
 * Shot の境目が拍に乗っているかを返す口（PHASE 6.3 / P63-1）。
 *
 * **`/timeline/issues` には載せない。** 拍が分かっていない状態は「指摘」ではなく、
 * issues に混ぜると severity を偽ることになる。直し方も違う
 * （外れているのは Shot を動かす / 拍が無いのは解析を流す）。
 *
 * 判定そのものは `@ixa/domain` の `alignBoundary` だけが持つ。
 * **しきい値をこのファイルに書かない**（lessons L-016）。
 */

/**
 * 拍の出どころの状態。**「楽曲が無い」「解析が無い」「拍が 0 件」を混ぜない**（L-015）。
 * どれも結果は「色が付かない」だが、利用者が取るべき次の行動が違う。
 *
 * `shot-compare.ts` の `ShotCompareBeatState` と同じ区別で、選び方も同じ
 * （マスター音源 → 無ければ先頭 → 最新の解析）。**あちらの private な `loadBeats` は
 * この `loadProjectBeats` に寄せられる**（downbeats を落とさない上位互換）。
 */
export const TimelineBeatSourceState = z
  .enum(['available', 'no_beats', 'no_analysis', 'no_track'])
  .openapi('TimelineBeatSourceState')
export type TimelineBeatSourceState = z.infer<typeof TimelineBeatSourceState>

/**
 * **`TimelineRoutesDeps` そのものに解析を足さない。** 同じ型を `renderRoutes` も使っており、
 * 書き出しに要らない依存が増える。`shotCompareRoutes` と同じく 1 つ足した形で受ける。
 */
export type BeatAlignmentRoutesDeps = TimelineRoutesDeps & {
  musicAnalyses: MusicAnalysisRepository
}

/** 拍の読み取り結果。件数 0 の理由を必ず添える。 */
export type ProjectBeats = {
  readonly state: TimelineBeatSourceState
  /** 拍の出どころにした楽曲の題。楽曲そのものが無ければ null。 */
  readonly trackTitle: string | null
  readonly beats: readonly number[]
  readonly downbeats: readonly number[]
}

/**
 * 吸着・A/B 比較と同じ選び方でマスター音源を選び、その解析から拍と小節頭を取る。
 *
 * **`offsetSec` は足さない。** 吸着（`timeline/page.tsx`）もストーリーボードも
 * 解析の値をそのまま絶対秒として扱っており、ここだけ足すと目盛りとズレる。
 */
export const loadProjectBeats = async (
  deps: Pick<BeatAlignmentRoutesDeps, 'musicTracks' | 'musicAnalyses'>,
  projectId: ProjectId,
): Promise<ProjectBeats> => {
  // 選び方は domain の `pickMasterTrack` だけが持つ。ここに書き写さない（L-016）。
  const track = pickMasterTrack(await deps.musicTracks.findByProject(projectId))
  if (track === null) {
    return { state: 'no_track', trackTitle: null, beats: [], downbeats: [] }
  }

  const analysis = await deps.musicAnalyses.findByTrack(track.id)
  if (analysis === null) {
    return { state: 'no_analysis', trackTitle: track.title, beats: [], downbeats: [] }
  }
  if (analysis.beats.length === 0) {
    return { state: 'no_beats', trackTitle: track.title, beats: [], downbeats: [] }
  }

  return {
    state: 'available',
    trackTitle: track.title,
    beats: [...analysis.beats],
    downbeats: [...analysis.downbeats],
  }
}

/**
 * Shot 1 件の整列。見るのは**開始位置だけ**。
 * 終わりは次の Shot の開始と同じ境目なので、両方数えると同じズレを二重に数える。
 */
export const ShotBeatAlignment = z
  .object({
    shotId: ShotIdSchema,
    atSec: SecondsSchema,
    /** 一番近い拍。拍が 1 件も無ければ null。 */
    nearestBeatSec: SecondsSchema.nullable(),
    /** 拍からのズレ（秒）。正なら拍より後ろ。拍が無ければ null（0 ではない）。 */
    driftSec: z.number().nullable(),
    alignment: BeatAlignmentSchema,
  })
  .openapi('ShotBeatAlignment')
export type ShotBeatAlignment = z.infer<typeof ShotBeatAlignment>

/**
 * 整列の一覧。**`source` を必ず添える。**
 * 解析が無い Project で件数だけを返すと、画面が「0 件が外れています」と
 * 嘘を出す（L-015）。
 */
export const TimelineBeatAlignmentResponse = z
  .object({
    source: TimelineBeatSourceState,
    trackTitle: z.string().nullable(),
    shots: z.array(ShotBeatAlignment),
  })
  .openapi('TimelineBeatAlignment')
export type TimelineBeatAlignmentResponse = z.infer<typeof TimelineBeatAlignmentResponse>

const getBeatAlignmentRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/timeline/beat-alignment',
  tags: ['timeline'],
  summary: 'Shot の境目が拍からどれだけズレているか',
  request: { params: ProjectParams },
  responses: {
    200: {
      description: '整列の一覧',
      content: {
        'application/json': { schema: successResponse(TimelineBeatAlignmentResponse) },
      },
    },
    404: errorContent('Project が存在しない'),
    500: errorContent('サーバ内部エラー'),
  },
})

/**
 * `timelineRoutes` と分けてあるのは、この口だけが楽曲解析を要るため。
 * 依存を 1 つ足すだけで済むよう、`shotCompareRoutes` と同じ形にしている。
 */
export const beatAlignmentRoutes = (deps: BeatAlignmentRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(
    getBeatAlignmentRoute,
    async (c) => {
      const { projectId } = c.req.valid('param')
      const project = await deps.projects.findById(projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const music = await loadProjectBeats(deps, projectId)
      const shots = await deps.shots.findByProject(projectId)

      return c.json(
        ok({
          source: music.state,
          trackTitle: music.trackTitle,
          shots: shots.map((shot) => ({
            shotId: shot.id,
            ...alignBoundary(shot.startSec, music.beats, music.downbeats),
          })),
        }),
        200,
      )
    },
  )
