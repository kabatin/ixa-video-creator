import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository, TextStyleRepository, TimelineClipRepository } from '@ixa/db'
import {
  ProjectId as ProjectIdSchema,
  TextStyle,
  TextStyleId as TextStyleIdSchema,
  TimelineClipId as TimelineClipIdSchema,
  type TimelineClip,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, okList } from '../response.js'
import { TimelineClipResponse } from './clips.js'

/**
 * テロップへ見た目をまとめて当てる（ADR-0028）。
 *
 * 各テロップの `params.style` と `params.styleId` だけを書き換え、**文字には触らない**。
 * 当てると値を写す（描くときに保存したスタイルを引きに行かない）ので、
 * スタイルを直したあとで反映したいときも、この口でもう一度当てる。
 * 1 件でもテロップ以外・別の Project のクリップが混じっていれば、何も変えずに 422。
 */

export type ClipTextStyleRoutesDeps = {
  readonly textStyles: Pick<TextStyleRepository, 'findById'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly timelineClips: Pick<TimelineClipRepository, 'findByProject' | 'update'>
}

/** 1 回に当てられる数。MV の歌詞（数十行）なら余裕がある。 */
export const MAX_TEXT_STYLE_CLIPS = 500

export const NOT_TEXT_CLIP_MESSAGE = 'このプロジェクトのテロップではないクリップが含まれています'
export const UNKNOWN_TEXT_STYLE_MESSAGE = 'このプロジェクトに、そのスタイルはありません'

const ApplyBody = z
  .object({
    clipIds: z.array(TimelineClipIdSchema).min(1).max(MAX_TEXT_STYLE_CLIPS),
    style: TextStyle,
    /** どの保存済みスタイルから当てたか。見た目だけ当てるなら null。 */
    styleId: TextStyleIdSchema.nullable(),
  })
  .openapi('ApplyTextStyleInput')

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const applyRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/clips/text-style', tags: ['clips'],
  summary: 'テロップへ見た目をまとめて当てる（文字は変えない）',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: ApplyBody } } },
  },
  responses: {
    200: {
      description: '当てた後のテロップ',
      content: { 'application/json': { schema: listResponse(TimelineClipResponse) } },
    },
    404: errorContent('Project が存在しない'),
    422: errorContent('テロップ以外が混じっている / 無いスタイル / 読めない見た目'),
    500: errorContent('サーバ内部エラー'),
  },
})

const withStyle = (clip: TimelineClip, style: TextStyle, styleId: string | null): TimelineClip['content'] => {
  if (clip.content.type !== 'text') return clip.content
  return { ...clip.content, params: { ...clip.content.params, style, styleId } }
}

export const clipTextStyleRoutes = (deps: ClipTextStyleRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(applyRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const { clipIds, style, styleId } = c.req.valid('json')

    if (styleId !== null) {
      const preset = await deps.textStyles.findById(styleId)
      if (preset === null || preset.projectId !== projectId) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { styleId: [UNKNOWN_TEXT_STYLE_MESSAGE] }), 422)
      }
    }

    const texts = new Map(
      (await deps.timelineClips.findByProject(projectId))
        .filter((clip) => clip.content.type === 'text')
        .map((clip) => [clip.id, clip] as const),
    )
    const targets = clipIds.map((id) => texts.get(id))
    if (targets.some((clip) => clip === undefined)) {
      return c.json(fail(VALIDATION_ERROR_MESSAGE, { clipIds: [NOT_TEXT_CLIP_MESSAGE] }), 422)
    }

    const updated: TimelineClip[] = []
    for (const clip of targets as TimelineClip[]) {
      updated.push(await deps.timelineClips.update(clip.id, { content: withStyle(clip, style, styleId) }))
    }
    return c.json(
      okList(updated.map((clip) => ({ ...clip, createdAt: clip.createdAt.toISOString() }))),
      200,
    )
  })
