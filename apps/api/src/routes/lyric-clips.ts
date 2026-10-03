import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  MediaAssetRepository,
  MusicTrackRepository,
  ProjectRepository,
  ShotRepository,
  TextStyleRepository,
  TimelineClipRepository,
} from '@ixa/db'
import {
  LYRIC_STYLE_NAME,
  LYRIC_TELOP_LAYER,
  ProjectId as ProjectIdSchema,
  lyricLineOf,
  lyricLines,
  lyricTelopSpans,
  type CreateTimelineClipInput,
  type ProjectId as ProjectIdType,
  type TextStylePreset,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { TimelineClipResponse, toClipResponse } from './clips.js'

/**
 * 歌詞をテロップにする（ADR-0033。制作者 2026-10-01「1 フレーズごとにテロップを自動生成できると入力の手間が省ける」）。
 *
 * 作品の歌詞と時刻（聴きながら Enter で打ったもの）から、フレーズごとに TEXT 帯の歌詞の層へ置く。
 * 区間の決め方は domain の `lyricTelopSpans`（次のフレーズの頭まで・間奏は上限で切る）。
 * **置き直すと、前に歌詞から置いたテロップ（何行目かの印が付いたもの）だけを差し替える。** 手で置いたものは残す。
 * 差し替えは 1 トランザクション（`TimelineClipRepository.replace`）。
 *
 * **Shot が無くても置ける。** 終わりは、最後の Shot の終わりと曲の終わりの遅い方（タイムラインの長さと同じ決め方）
 * （制作者 2026-10-03「テロップがあるだけではプレビューが再生できず、音楽とテロップがあっているかの確認が出来ない」）。
 * 区切る前に、黒い画面で音とテロップを確かめられる。以前は最後の Shot の終わりで切っていて、曲の後半の歌詞が落ちた。
 */

export const NO_LYRIC_CUES_MESSAGE =
  '歌詞の時刻がまだありません。「聴きながら切る」の「歌詞を合わせる」で、歌い出しに合わせて Enter を押してください。'
export const NO_LENGTH_FOR_LYRICS_MESSAGE =
  '曲の長さがまだ分からないので、テロップを置けません。楽曲の解析が終わってからもう一度試してください。'

export type LyricClipDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly shots: Pick<ShotRepository, 'findByProject'>
  readonly timelineClips: Pick<TimelineClipRepository, 'findByProject' | 'replace'>
  readonly textStyles: Pick<TextStyleRepository, 'findByProject'>
  /** 曲の終わりを知るため（タイムラインの長さと同じく、音源の probe の尺を使う）。 */
  readonly musicTracks: Pick<MusicTrackRepository, 'findByProject'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
}

const PlacedData = z
  .object({
    clips: z.array(TimelineClipResponse),
    /** 差し替えた（前に歌詞から置いた）テロップの数。 */
    replacedCount: z.number().int().nonnegative(),
    /** 時刻の付いたフレーズの数。 */
    timedCount: z.number().int().nonnegative(),
    /** 歌詞のフレーズの数。 */
    lineCount: z.number().int().nonnegative(),
  })
  .openapi('PlacedLyricClips')

const placeRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/clips/lyrics',
  tags: ['timeline'],
  summary: '歌詞をフレーズごとのテロップにする（前に歌詞から置いたテロップは差し替える）',
  request: { params: z.object({ projectId: ProjectIdSchema }) },
  responses: {
    200: {
      description: '置いたテロップ',
      content: { 'application/json': { schema: successResponse(PlacedData) } },
    },
    404: errorContent('Project が存在しない'),
    422: errorContent('時刻がまだ無い・曲の長さも Shot も無い'),
  },
})

/** 歌詞のテロップの中身。保存した「歌詞」のスタイルがあればその見た目で、どこから当てたかも残す。 */
const lyricContent = (
  text: string,
  lineIndex: number,
  preset: TextStylePreset | undefined,
): CreateTimelineClipInput['content'] => ({
  type: 'text',
  templateKey: 'plain',
  params: {
    text,
    lyricLine: lineIndex,
    ...(preset === undefined ? {} : { style: preset.style, styleId: preset.id }),
  },
})

/** 曲の終わり（開始位置 + 音源の尺）。尺が分からない曲は数えない。 */
const songEndsOf = async (deps: LyricClipDeps, projectId: ProjectIdType): Promise<readonly number[]> => {
  const tracks = await deps.musicTracks.findByProject(projectId)
  const assets = await Promise.all(tracks.map((track) => deps.mediaAssets.findById(track.mediaAssetId)))
  return tracks.flatMap((track, index) => {
    const durationSec = assets[index]?.probe?.durationSec ?? null
    return durationSec === null ? [] : [track.offsetSec + durationSec]
  })
}

export const lyricClipRoutes = (deps: LyricClipDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(placeRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    const project = await deps.projects.findById(projectId)
    if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    if (project.lyricCues.length === 0) return c.json(fail(NO_LYRIC_CUES_MESSAGE), 422)

    const [shots, songEnds] = await Promise.all([deps.shots.findByProject(projectId), songEndsOf(deps, projectId)])
    const programEndSec = Math.max(0, ...shots.map((shot) => shot.startSec + shot.durationSec), ...songEnds)
    if (programEndSec <= 0) return c.json(fail(NO_LENGTH_FOR_LYRICS_MESSAGE), 422)

    const lines = lyricLines(project.lyrics)
    const spans = lyricTelopSpans(lines, project.lyricCues, programEndSec)
    const [clips, presets] = await Promise.all([
      deps.timelineClips.findByProject(projectId),
      deps.textStyles.findByProject(projectId),
    ])
    const preset = presets.find((candidate) => candidate.name === LYRIC_STYLE_NAME)
    const previous = clips.filter(
      (clip) => clip.content.type === 'text' && lyricLineOf(clip.content.params) !== null,
    )

    const placed = await deps.timelineClips.replace(
      previous.map((clip) => clip.id),
      spans.map((span) => ({
        projectId,
        track: 'TEXT',
        startSec: span.startSec,
        durationSec: span.durationSec,
        layer: LYRIC_TELOP_LAYER,
        content: lyricContent(span.text, span.lineIndex, preset),
        opacity: 1,
      })),
    )
    return c.json(
      ok({
        clips: placed.map(toClipResponse),
        replacedCount: previous.length,
        timedCount: Math.min(project.lyricCues.length, lines.length),
        lineCount: lines.length,
      }),
      200,
    )
  })
