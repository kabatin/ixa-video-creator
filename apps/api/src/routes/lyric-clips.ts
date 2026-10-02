import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
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
 */

export const NO_LYRIC_CUES_MESSAGE =
  '歌詞の時刻がまだありません。「聴きながら切る」の「歌詞を合わせる」で、歌い出しに合わせて Enter を押してください。'
export const NO_SHOTS_FOR_LYRICS_MESSAGE =
  'Shot がまだ無いので、テロップを置く場所がありません。先に区切って Shot を作ってください。'

export type LyricClipDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly shots: Pick<ShotRepository, 'findByProject'>
  readonly timelineClips: Pick<TimelineClipRepository, 'findByProject' | 'replace'>
  readonly textStyles: Pick<TextStyleRepository, 'findByProject'>
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
    422: errorContent('時刻がまだ無い・置く場所（Shot）が無い'),
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

export const lyricClipRoutes = (deps: LyricClipDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(placeRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    const project = await deps.projects.findById(projectId)
    if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    if (project.lyricCues.length === 0) return c.json(fail(NO_LYRIC_CUES_MESSAGE), 422)

    const shots = await deps.shots.findByProject(projectId)
    const programEndSec = Math.max(0, ...shots.map((shot) => shot.startSec + shot.durationSec))
    if (programEndSec <= 0) return c.json(fail(NO_SHOTS_FOR_LYRICS_MESSAGE), 422)

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
