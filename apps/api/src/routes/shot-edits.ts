import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository, ShotCharacterRepository, ShotRepository, TakeRepository } from '@ixa/db'
import {
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  planMerge,
  planSplit,
  splitShotCode,
  type Shot,
  type ShotId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { ShotResponse, toShotResponse } from './shots.js'

/**
 * Shot の分割と結合（制作者の要望 2026-09-26 / ADR-0024）。
 *
 * 規則（Take の無い Shot だけ・最短の尺・隣り合うこと）は domain の `planSplit` / `planMerge`
 * が持つ。ここは**状態では分からない Take の有無を件数で確かめて**から書く。
 * 取り消しの記録は残さない。確認は画面が取る。
 */

export type ShotEditRoutesDeps = {
  readonly shots: ShotRepository
  readonly projects: ProjectRepository
  readonly takes: Pick<TakeRepository, 'findByShot'>
  readonly shotCharacters: Pick<ShotCharacterRepository, 'findByShot' | 'replaceAll'>
}

/** 並び順の刻み。Shot の order は 1000 刻みで採番する（ARCHITECTURE §19）。 */
const ORDER_STEP = 1000

const HAS_TAKE_REASON = 'Take があります（Take の無い Shot だけ分割・結合できます）'

const ShotParams = z.object({
  id: ShotIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})
const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const SplitBody = z
  .object({ atSec: z.number().finite().nonnegative().openapi({ description: '割る位置（タイムライン上の秒）' }) })
  .openapi('SplitShotInput')
const SplitData = z.object({ first: ShotResponse, second: ShotResponse }).openapi('SplitShotResult')

const MergeBody = z.object({ shotIds: z.array(ShotIdSchema).min(2).max(200) }).openapi('MergeShotsInput')
const MergeData = z
  .object({ shot: ShotResponse, removedShotIds: z.array(ShotIdSchema) })
  .openapi('MergeShotsResult')

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('Shot / Project が存在しない'),
  422: errorContent('入力の検証に失敗した / 分割・結合できない'),
  500: errorContent('サーバ内部エラー'),
}

const splitRoute = createRoute({
  method: 'post', path: '/shots/{id}/split', tags: ['shots'],
  summary: 'Take の無い Shot を位置で前後に割る',
  request: { params: ShotParams, body: { required: true, content: { 'application/json': { schema: SplitBody } } } },
  responses: { 200: jsonContent('割った前半と後半', successResponse(SplitData)), ...commonErrors },
})

const mergeRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/shots/merge', tags: ['shots'],
  summary: '隣り合う Take の無い Shot を先頭にまとめる',
  request: { params: ProjectParams, body: { required: true, content: { 'application/json': { schema: MergeBody } } } },
  responses: { 200: jsonContent('まとめた Shot と消した Shot', successResponse(MergeData)), ...commonErrors },
})

const hasTakes = async (deps: ShotEditRoutesDeps, shotId: ShotId): Promise<boolean> =>
  (await deps.takes.findByShot(shotId)).length > 0

/**
 * 元の Shot の直後に入る order。**隙間が無ければ並べ直してから入れる**
 * （order は挿入時に再採番しない方針だが、割った後半を末尾に回すと一覧の並びが崩れる）。
 */
const orderAfter = async (deps: ShotEditRoutesDeps, shot: Shot): Promise<number> => {
  const siblings = (await deps.shots.findByProject(shot.projectId)).sort((a, b) => a.order - b.order)
  const next = siblings.find((sibling) => sibling.order > shot.order)
  if (next === undefined) return shot.order + ORDER_STEP
  if (next.order - shot.order >= 2) return Math.floor((shot.order + next.order) / 2)
  for (const [index, sibling] of siblings.entries()) {
    const order = (index + 1) * ORDER_STEP
    if (sibling.order !== order) await deps.shots.update(sibling.id, { order })
  }
  const position = siblings.findIndex((sibling) => sibling.id === shot.id)
  return (position + 1) * ORDER_STEP + ORDER_STEP / 2
}

export const shotEditRoutes = (deps: ShotEditRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(splitRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const { atSec } = c.req.valid('json')

      const plan = planSplit(shot, atSec)
      const reason = !plan.ok ? plan.reason : (await hasTakes(deps, shot.id)) ? HAS_TAKE_REASON : null
      if (reason !== null || !plan.ok) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { atSec: [reason ?? ''] }), 422)
      }

      const order = await orderAfter(deps, shot)
      const used = new Set((await deps.shots.findByProject(shot.projectId)).map((sibling) => sibling.code))
      const first = await deps.shots.update(shot.id, { durationSec: plan.firstDurationSec })
      const second = await deps.shots.create({
        projectId: shot.projectId,
        sequenceId: shot.sequenceId,
        order,
        code: splitShotCode(shot.code, used),
        startSec: plan.secondStartSec,
        durationSec: plan.secondDurationSec,
        description: shot.description,
        dialogue: shot.dialogue,
        camera: shot.camera,
        mood: shot.mood,
        continuityMode: shot.continuityMode,
        locationId: shot.locationId,
        sourceType: shot.sourceType,
        status: shot.status,
      })
      // 登場人物も引き継ぐ。参照（reference）は生成時に登場人物とロケーションから導かれる。
      const cast = await deps.shotCharacters.findByShot(shot.id)
      if (cast.length > 0) {
        await deps.shotCharacters.replaceAll(
          second.id,
          cast.map(({ characterId, lookId, prominence, order: castOrder }) => ({
            characterId, lookId, prominence, order: castOrder,
          })),
        )
      }
      return c.json(ok({ first: toShotResponse(first), second: toShotResponse(second) }), 200)
    })
    .openapi(mergeRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }
      const reject = (reason: string) =>
        c.json(fail(VALIDATION_ERROR_MESSAGE, { shotIds: [reason] }), 422)

      const shots: Shot[] = []
      for (const shotId of c.req.valid('json').shotIds) {
        const shot = await deps.shots.findById(shotId)
        if (shot === null || shot.projectId !== projectId) {
          return reject('この Project の Shot ではないものが含まれています')
        }
        if (await hasTakes(deps, shot.id)) return reject(`${shot.code}: ${HAS_TAKE_REASON}`)
        shots.push(shot)
      }

      const plan = planMerge(shots)
      if (!plan.ok) return reject(plan.reason)

      const merged = await deps.shots.update(plan.keep.id, { durationSec: plan.durationSec })
      for (const removed of plan.remove) await deps.shots.softDelete(removed.id)
      return c.json(
        ok({ shot: toShotResponse(merged), removedShotIds: plan.remove.map((removed) => removed.id) }),
        200,
      )
    })
