import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  NARRATION_TEXT_MAX,
  NarrationLineId as NarrationLineIdSchema,
  ProjectId as ProjectIdSchema,
  Seconds,
  UpdateNarrationLinePatch,
  VoiceProfileId as VoiceProfileIdSchema,
  lyricLines,

  type ProjectId,
  type VoiceProfileId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import type { NarrationDeps } from '../narration/deps.js'
import { syncTelops } from '../narration/telops.js'
import { buildNarrationOverview, lineLengthSec } from '../narration/overview.js'
import { NarrationOverviewResponse, toOverviewResponse } from '../narration/overview-response.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * ナレーションの原稿（ADR-0038）。貼り付けた原稿を行に分け、行ごとに表示・読み・声・演出・位置を持つ。
 * 声にする（ジョブ）のは `narration-speak.ts`。
 */

/** 貼り付ける原稿の上限（字）。 */
const SCRIPT_MAX = 20_000
/** 並べて置くときの行の間の上限（秒）。 */
const ARRANGE_GAP_MAX_SEC = 10

const ProjectParams = z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) })
const LineParams = z.object({ id: NarrationLineIdSchema.openapi({ param: { name: 'id', in: 'path' } }) })
const ScriptBody = z
  .object({ text: z.string().max(SCRIPT_MAX), voiceProfileId: VoiceProfileIdSchema.nullable().default(null) })
  .openapi('PasteNarrationScript')
const OrderBody = z.object({ lineIds: z.array(NarrationLineIdSchema).max(1000) }).openapi('ReorderNarrationLines')
const ArrangeBody = z
  .object({
    fromSec: Seconds,
    gapSec: z.number().min(0).max(ARRANGE_GAP_MAX_SEC),
    /** 置く行（渡した順に置く）。無ければ全部を並び順に。 */
    lineIds: z.array(NarrationLineIdSchema).max(1000).optional(),
  })
  .openapi('ArrangeNarrationLines')
const LinePatch = UpdateNarrationLinePatch.omit({ order: true }).openapi('UpdateNarrationLinePatch')

const json = <T extends z.ZodTypeAny>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } })
const body = <T extends z.ZodTypeAny>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } })
const errors = { 404: errorContent('対象が存在しない'), 422: errorContent('入力の検証に失敗した') }
const overviewOk = json('ナレーションの一覧', successResponse(NarrationOverviewResponse))

const overviewRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/narration', tags: ['narration'],
  summary: 'ナレーションの一覧（読み・話す長さの見積もり・声の Take・作り直しが要るか）',
  request: { params: ProjectParams },
  responses: { 200: overviewOk, ...errors },
})
const scriptRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/narration/script', tags: ['narration'],
  summary: '原稿を貼り付ける（1 行 = 1 フレーズ。今ある行の後ろに足す）',
  request: { params: ProjectParams, body: body(ScriptBody) },
  responses: { 201: overviewOk, ...errors },
})
const patchRoute = createRoute({
  method: 'patch', path: '/narration-lines/{id}', tags: ['narration'],
  summary: '行を直す（表示・読み・声・演出・位置・テロップ・選ぶ Take）',
  request: { params: LineParams, body: body(LinePatch) },
  responses: { 200: overviewOk, ...errors },
})
const deleteRoute = createRoute({
  method: 'delete', path: '/narration-lines/{id}', tags: ['narration'],
  summary: '行を消す',
  request: { params: LineParams },
  responses: { 204: { description: '消した（本文なし）' }, ...errors },
})
const orderRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/narration/order', tags: ['narration'],
  summary: '行を並べ替える（作品の行を全部 1 度ずつ渡す）',
  request: { params: ProjectParams, body: body(OrderBody) },
  responses: { 200: overviewOk, ...errors },
})
const arrangeRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/narration/arrange', tags: ['narration'],
  summary: '選んだ位置から、行を間を空けて順に置く（声が無ければ見積もりの長さで）',
  request: { params: ProjectParams, body: body(ArrangeBody) },
  responses: { 200: overviewOk, ...errors },
})

/** その声がこの作品のものか。 */
const voiceBelongs = async (deps: NarrationDeps, projectId: ProjectId, voiceId: VoiceProfileId | null): Promise<boolean> =>
  voiceId === null || (await deps.voices.findById(voiceId))?.projectId === projectId

const tooLongLine = (lines: readonly string[]): string | null => {
  const index = lines.findIndex((line) => [...line].length > NARRATION_TEXT_MAX)
  if (index === -1) return null
  return `${index + 1} 行目が長すぎます（${[...(lines[index] ?? '')].length} 字。1 行は ${NARRATION_TEXT_MAX} 字まで）。句点で分けて別の行にしてください`
}

const overviewJson = async (deps: NarrationDeps, projectId: ProjectId) =>
  ok(toOverviewResponse(await buildNarrationOverview(deps, projectId)))

export const narrationLineRoutes = (deps: NarrationDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(overviewRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(await overviewJson(deps, projectId), 200)
    })
    .openapi(scriptRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const { text, voiceProfileId } = c.req.valid('json')
      const lines = lyricLines(text)
      const problem = tooLongLine(lines)
      if (problem !== null) return c.json(fail(problem, { text: [problem] }), 422)
      if (!(await voiceBelongs(deps, projectId, voiceProfileId))) {
        return c.json(fail('この作品の声ではありません', { voiceProfileId: ['この作品の声ではありません'] }), 422)
      }
      const existing = await deps.lines.findByProject(projectId)
      const next = existing.reduce((max, line) => Math.max(max, line.order + 1), 0)
      await deps.lines.createMany(lines.map((line, index) => ({ projectId, order: next + index, text: line, voiceProfileId })))
      return c.json(await overviewJson(deps, projectId), 201)
    })
    .openapi(patchRoute, async (c) => {
      const { id } = c.req.valid('param')
      const current = await deps.lines.findById(id)
      if (current === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const patch = c.req.valid('json')
      if (patch.voiceProfileId !== undefined && !(await voiceBelongs(deps, current.projectId, patch.voiceProfileId))) {
        return c.json(fail('この作品の声ではありません', { voiceProfileId: ['この作品の声ではありません'] }), 422)
      }
      if (patch.selectedTakeId !== undefined && patch.selectedTakeId !== null) {
        const take = await deps.takes.findById(patch.selectedTakeId)
        if (take?.lineId !== id) return c.json(fail('この行の声ではありません', { selectedTakeId: ['この行の声ではありません'] }), 422)
      }
      await deps.lines.update(id, patch)
      // 話す声を変えたら、その声の見た目に当て直す（ほかは今の見た目を引き継ぐ）。
      const voiceChanged = patch.voiceProfileId !== undefined && patch.voiceProfileId !== current.voiceProfileId
      await syncTelops(deps, current.projectId, voiceChanged ? [id] : [])
      return c.json(await overviewJson(deps, current.projectId), 200)
    })
    .openapi(deleteRoute, async (c) => {
      const { id } = c.req.valid('param')
      const current = await deps.lines.findById(id)
      if (current === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      await deps.lines.softDelete(id)
      await syncTelops(deps, current.projectId)
      return c.body(null, 204)
    })
    .openapi(orderRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const { lineIds } = c.req.valid('json')
      const current = (await deps.lines.findByProject(projectId)).map((line) => line.id as string)
      const same = lineIds.length === current.length && new Set(lineIds).size === lineIds.length && lineIds.every((id) => current.includes(id))
      if (!same) {
        const message = '作品の行を全部、1 度ずつ並べてください（画面を読み直してからやり直してください）'
        return c.json(fail(message, { lineIds: [message] }), 422)
      }
      await deps.lines.reorder(projectId, lineIds)
      return c.json(await overviewJson(deps, projectId), 200)
    })
    .openapi(arrangeRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const { fromSec, gapSec, lineIds } = c.req.valid('json')
      const overview = await buildNarrationOverview(deps, projectId)
      const targets =
        lineIds === undefined
          ? overview.lines
          : lineIds.flatMap((id) => overview.lines.filter((line) => line.id === id))
      if (lineIds !== undefined && targets.length !== lineIds.length) {
        return c.json(fail('この作品の行ではないものがあります', { lineIds: ['この作品の行ではないものがあります'] }), 422)
      }
      let at = fromSec
      for (const line of targets) {
        await deps.lines.update(line.id, { startSec: Math.round(at * 1000) / 1000 })
        at += lineLengthSec(line) + gapSec
      }
      // 1 回押すと置いた行の位置が全部変わる。戻せるように、置く前の位置を記録する（ADR-0038）。
      if (targets.length > 0) {
        await deps.editBatches?.create({
          projectId,
          kind: 'narration_arrange',
          summary: `ナレーション ${String(targets.length)} 行を並べました`,
          entries: [],
          lineEntries: targets.map((line) => ({ lineId: line.id, startSec: line.startSec })),
        })
      }
      await syncTelops(deps, projectId)
      return c.json(await overviewJson(deps, projectId), 200)
    })

