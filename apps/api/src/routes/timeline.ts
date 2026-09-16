import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  MediaAssetRepository, MusicTrackRepository, ProjectRepository, ShotRepository, TakeRepository,
  TimelineClipRepository, TransitionRepository,
} from '@ixa/db'
import {
  ProjectId as ProjectIdSchema,
  TimelineDocument as TimelineDocumentSchema,
  type MediaAsset,
  type MediaAssetId,
  type Project,
  type ProjectId,
  type Shot,
  type ShotId,
  type TimelineClip,
} from '@ixa/domain'
import { buildTimelineDocument, type TimelineMusicTrack, type TimelineSource } from '@ixa/timeline'
import type { ObjectStorage } from '@ixa/storage'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

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

/**
 * 音楽トラックの音量。`MusicTrack` は音量列を持たないため既定値で埋める。
 * 音量調整は Phase 1 の範囲外（spec.md §22 の Non Goal ではないが、列が無い）。
 */
export const DEFAULT_MUSIC_VOLUME = 1

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
        volume: DEFAULT_MUSIC_VOLUME,
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

export const timelineRoutes = (deps: TimelineRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(getTimelineRoute, async (c) => {
    const loaded = await loadTimelineDocument(deps, c.req.valid('param').projectId)
    if (loaded === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    return c.json(ok(loaded.document), 200)
  })
