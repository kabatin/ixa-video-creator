import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { EditTransaction, ProjectRepository, TimelineClipRepository } from '@ixa/db'
import {
  ProjectId as ProjectIdSchema,
  Seconds,
  TimelineClipId as TimelineClipIdSchema,
  clipEditSummary,
  clipNounOf,
  type EditBatchClipEdit,
  type TimelineClip,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, okList, listResponse } from '../response.js'
import { recordClipEdits, updateEditOf } from './clip-edit-recording.js'
import { NON_POSITIVE_DURATION_MESSAGE, TimelineClipResponse, toClipResponse } from './clips.js'

/**
 * 帯でいくつかのクリップの位置と尺をいっしょに変える（境目を動かすと隣も付いてくる）。**1 つの記録にまとめる。**
 * 1 件ずつ PATCH すると記録が 2 つに割れ、⌘Z 1 回では片方しか戻らない。
 *
 * ```
 * POST /projects/{projectId}/clips/spans   { spans: [{ id, startSec, durationSec }] }
 * ```
 *
 * **送られた順に書く**（縮む側を先に送れば、途中で重ならない）。1 件でも無い・別の作品のものなら何も書かない。
 */

/** 帯で一度に動くのは当人と隣の 2 件。余裕を見て上限を置く（際限なく受けない）。 */
export const MAX_CLIP_SPANS = 10

const SpanBody = z
  .object({
    spans: z
      .array(z.object({ id: TimelineClipIdSchema, startSec: Seconds, durationSec: Seconds }))
      .min(1)
      .max(MAX_CLIP_SPANS),
  })
  .openapi('UpdateClipSpansInput')

const spansRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/clips/spans',
  tags: ['clips'],
  summary: 'いくつかのクリップの位置と尺をいっしょに変える（1 つの記録にまとめる）',
  request: {
    params: z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) }),
    body: { required: true, content: { 'application/json': { schema: SpanBody } } },
  },
  responses: {
    200: { description: '更新後のクリップ（送った順）', content: { 'application/json': { schema: listResponse(TimelineClipResponse) } } },
    404: errorContent('作品・クリップが存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

export type ClipSpanDeps = {
  readonly timelineClips: Pick<TimelineClipRepository, 'findById'>
  readonly projects: Pick<ProjectRepository, 'findById'>
  /** 記録と書き込みを同じトランザクションで（途中で落ちれば、記録も一部の書き込みも残らない）。 */
  readonly transaction: EditTransaction
}

/** 2 件以上なら「境目を動かす」。1 件なら単独の見出しと同じ。 */
const summaryOf = (clips: readonly TimelineClip[]): string => {
  const [first] = clips
  if (first === undefined) return 'クリップを動かす'
  return clips.length === 1 ? clipEditSummary('update', first, ['startSec']) : `${clipNounOf(first)}の境目を動かす`
}

export const clipSpanRoutes = (deps: ClipSpanDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(spansRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const { spans } = c.req.valid('json')
    const zeroIndex = spans.findIndex((span) => span.durationSec <= 0)
    if (zeroIndex >= 0) {
      return c.json(fail(VALIDATION_ERROR_MESSAGE, { [`spans.${String(zeroIndex)}.durationSec`]: [NON_POSITIVE_DURATION_MESSAGE] }), 422)
    }

    const found = await Promise.all(spans.map((span) => deps.timelineClips.findById(span.id)))
    const clips = found.filter((clip): clip is TimelineClip => clip !== null && clip.projectId === projectId)
    if (clips.length !== spans.length) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    const edits = spans
      .map((span, index) => {
        const clip = clips[index]
        return clip === undefined ? null : updateEditOf(clip, { startSec: span.startSec, durationSec: span.durationSec })
      })
      .filter((edit): edit is EditBatchClipEdit => edit !== null)
    // 記録は書く前に、同じトランザクションで作る。変わらない分は記録に入れない。
    const updated = await deps.transaction(async (tx) => {
      await recordClipEdits(tx.editBatches, { projectId, summary: summaryOf(clips), edits })
      const written: TimelineClip[] = []
      for (const span of spans) {
        // 1 件ずつ順に書く（縮む側が先。同時に送ると順が保てない）。
        written.push(await tx.timelineClips.update(span.id, { startSec: span.startSec, durationSec: span.durationSec }))
      }
      return written
    })
    return c.json(okList(updated.map(toClipResponse)), 200)
  })
