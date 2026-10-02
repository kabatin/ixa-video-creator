import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { EditBatchRepository, ProjectRepository, TextStyleRepository, TimelineClipRepository } from '@ixa/db'
import {
  ProjectId as ProjectIdSchema,
  TextStyle,
  TextStyleId as TextStyleIdSchema,
  TextStyleKey,
  TimelineClipId as TimelineClipIdSchema,
  mergeTextStyle,
  textStyleChangeSummary,
  type EditBatchClipEntry,
  type TextStyleId as TextStyleIdType,
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
 *
 * 形は 2 つ（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。
 * - 丸ごと: `{ clipIds, style, styleId }`。見た目を写す（保存したスタイルを当てる）
 * - 項目だけ: `{ clipIds, set, unset }`。変えた項目だけ重ね、ほかの項目・styleId はテロップごとに残す
 *
 * **どちらも変える前の見た目を変更の履歴に残す**（取り消せる）。記録は書く直前に作り、作れなければ 1 件も書かない。
 */

export type ClipTextStyleRoutesDeps = {
  readonly textStyles: Pick<TextStyleRepository, 'findById'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly timelineClips: Pick<TimelineClipRepository, 'findByProject' | 'update'>
  readonly editBatches: Pick<EditBatchRepository, 'create'>
}

/** 1 回に当てられる数。MV の歌詞（数十行）なら余裕がある。 */
export const MAX_TEXT_STYLE_CLIPS = 500

export const NOT_TEXT_CLIP_MESSAGE = 'このプロジェクトのテロップではないクリップが含まれています'
export const UNKNOWN_TEXT_STYLE_MESSAGE = 'このプロジェクトに、そのスタイルはありません'

export const APPLY_SHAPE_MESSAGE =
  '丸ごと当てるなら style と styleId を、項目だけ変えるなら set と unset を送ってください（混ぜない）'

/**
 * 本文は 1 つの形にし、**欄ごとの指摘を残す**（2 つの形の「どちらか」にすると、空の本文で
 * 「本文全体が違う」としか言えず、clipIds が無いことが分からなくなった）。
 * 丸ごと（style・styleId）か項目だけ（set・unset）かは、ここで確かめる。
 */
const ApplyBody = z
  .object({
    clipIds: z.array(TimelineClipIdSchema).min(1).max(MAX_TEXT_STYLE_CLIPS),
    /** 丸ごと: 見た目を写す（保存したスタイルを当てる）。 */
    style: TextStyle.optional(),
    /** 丸ごと: どの保存済みスタイルから当てたか。見た目だけ当てるなら null。 */
    styleId: TextStyleIdSchema.nullable().optional(),
    /** 項目だけ: この項目を上書きする。styleId は触らない。 */
    set: TextStyle.optional(),
    /** 項目だけ: この項目を外す（型の既定に戻す）。 */
    unset: z.array(TextStyleKey).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const replace = body.style !== undefined || body.styleId !== undefined
    const merge = body.set !== undefined || body.unset !== undefined
    const complete = replace
      ? body.style !== undefined && body.styleId !== undefined && !merge
      : body.set !== undefined && body.unset !== undefined
    if (!complete) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['style'], message: APPLY_SHAPE_MESSAGE })
  })
  .openapi('ApplyTextStyleInput')
type ApplyBodyInput = z.infer<typeof ApplyBody>

/** 確かめた後の形。丸ごとか項目だけか。 */
type ApplyBody =
  | { readonly clipIds: readonly TimelineClip['id'][]; readonly style: TextStyle; readonly styleId: TextStyleIdType | null }
  | { readonly clipIds: readonly TimelineClip['id'][]; readonly set: TextStyle; readonly unset: readonly TextStyleKey[] }

const toApplyBody = (body: ApplyBodyInput): ApplyBody =>
  body.style !== undefined
    ? { clipIds: body.clipIds, style: body.style, styleId: body.styleId ?? null }
    : { clipIds: body.clipIds, set: body.set ?? {}, unset: body.unset ?? [] }

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

const paramsOf = (clip: TimelineClip): Record<string, unknown> =>
  clip.content.type === 'text' ? clip.content.params : {}

/** 書き換えた後の中身。丸ごとなら写し、項目だけなら重ねる（styleId はそのまま）。 */
const nextContent = (clip: TimelineClip, body: ApplyBody): TimelineClip['content'] => {
  if ('style' in body) return withStyle(clip, body.style, body.styleId)
  const params = paramsOf(clip)
  const styleId = typeof params.styleId === 'string' ? params.styleId : null
  return withStyle(clip, mergeTextStyle(params.style, body.set, body.unset), styleId)
}

/** 変える前（書いてあったそのまま）。見た目が無かったテロップは null（戻すときに外す）。 */
const beforeEntry = (clip: TimelineClip): EditBatchClipEntry => {
  const params = paramsOf(clip)
  return {
    clipId: clip.id,
    style: params.style ?? null,
    styleId: typeof params.styleId === 'string' ? params.styleId : null,
  }
}

const summaryOf = (body: ApplyBody): string =>
  'style' in body
    ? textStyleChangeSummary(body.clipIds.length, null)
    : textStyleChangeSummary(body.clipIds.length, {
        set: Object.keys(body.set) as TextStyleKey[],
        unset: body.unset,
      })

export const clipTextStyleRoutes = (deps: ClipTextStyleRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(applyRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const body = toApplyBody(c.req.valid('json'))
    const { clipIds } = body
    const styleId = 'style' in body ? body.styleId : null

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

    const clipsToChange = targets as TimelineClip[]
    // 書く直前に、変える前を記録する。作れなければ 1 件も書かない（Shot の一括変更と同じ）。
    await deps.editBatches.create({
      projectId,
      kind: 'text_style',
      summary: summaryOf(body),
      entries: [],
      clipEntries: clipsToChange.map(beforeEntry),
    })
    const updated: TimelineClip[] = []
    for (const clip of clipsToChange) {
      updated.push(await deps.timelineClips.update(clip.id, { content: nextContent(clip, body) }))
    }
    return c.json(
      okList(updated.map((clip) => ({ ...clip, createdAt: clip.createdAt.toISOString() }))),
      200,
    )
  })
