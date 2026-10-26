import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { EditTransaction, ProjectRepository, ShotCharacterRepository, ShotRepository, TakeRepository } from '@ixa/db'
import {
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  planMerge,
  planSplit,
  newId,
  splitShotCode,
  type Shot,
  type ShotId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { editBatchEntry, shotBeforePatch } from './edit-batch-recording.js'
import { recordShotEdits } from './shot-edit-recording.js'
import { ShotResponse, toShotResponse } from './shots.js'

/**
 * Shot の分割と結合（制作者の要望 2026-09-26 / ADR-0024）。
 *
 * 規則（Take の無い Shot だけ・最短の尺・隣り合うこと）は domain の `planSplit` / `planMerge`
 * が持つ。ここは**状態では分からない Take の有無を件数で確かめて**から書く。
 * **書く前に、書き込みと同じトランザクションで取り消しの記録を作る**（2026-10-19）。分割は「元の尺 + 後半の作成」、
 * 結合は「残す Shot の尺 + ほかの削除」を 1 つの記録にし、⌘Z 1 回で元に戻る。
 * 後半を挟むための並び順の振り直しは記録しない（並びの前後は変わらないので、戻しても害が無い）。
 */

export type ShotEditRoutesDeps = {
  readonly shots: ShotRepository
  readonly projects: ProjectRepository
  readonly takes: Pick<TakeRepository, 'findByShot'>
  readonly shotCharacters: Pick<ShotCharacterRepository, 'findByShot' | 'replaceAll'>
  /** 記録と書き込みを同じトランザクションで行う口。**省けない。** */
  readonly transaction: EditTransaction
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
const orderAfter = async (deps: Pick<ShotEditRoutesDeps, 'shots'>, shot: Shot): Promise<number> => {
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

      const secondId = newId(ShotIdSchema)
      const firstPatch = { durationSec: plan.firstDurationSec }
      const cast = await deps.shotCharacters.findByShot(shot.id)
      const used = new Set((await deps.shots.findByProject(shot.projectId)).map((sibling) => sibling.code))
      const { first, second } = await deps.transaction(async (tx) => {
        await recordShotEdits(tx.editBatches, {
          projectId: shot.projectId,
          summary: `${shot.code} を分割する`,
          entries: [editBatchEntry(shot.id, shotBeforePatch(shot, firstPatch))],
          shotEdits: [{ op: 'create', shotId: secondId }],
        })
        const order = await orderAfter({ shots: tx.shots }, shot)
        const shortened = await tx.shots.update(shot.id, firstPatch)
        const created = await tx.shots.create({
          id: secondId,
          projectId: shot.projectId,
          sequenceId: shot.sequenceId,
          order,
          code: splitShotCode(shot.code, used),
          startSec: plan.secondStartSec,
          durationSec: plan.secondDurationSec,
          // 合わせ方と速さ（ADR-0026・0050）も引き継ぐ。割っただけで後半が 1 倍に戻らない。
          timing: shot.timing,
          speed: shot.speed,
          // Take の音の大きさと消音（ADR-0060）も引き継ぐ。消音の Shot を割って後半だけ鳴り出さない。
          takeAudioVolume: shot.takeAudioVolume,
          takeAudioMuted: shot.takeAudioMuted,
          description: shot.description,
          // セリフは前半に残す（両方に写すと同じセリフを 2 度しゃべる。ADR-0059）。後半で言わせるなら移し替える。
          dialogue: [],
          camera: shot.camera,
          mood: shot.mood,
          continuityMode: shot.continuityMode,
          locationId: shot.locationId,
          sourceType: shot.sourceType,
          status: shot.status,
        })
        // 登場人物も引き継ぐ。参照（reference）は生成時に登場人物とロケーションから導かれる。
        if (cast.length > 0) {
          await tx.shotCharacters.replaceAll(
            created.id,
            cast.map(({ characterId, lookId, prominence, order: castOrder }) => ({
              characterId, lookId, prominence, order: castOrder,
            })),
          )
        }
        return { first: shortened, second: created }
      })
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

      const keepPatch = { durationSec: plan.durationSec }
      const merged = await deps.transaction(async (tx) => {
        await recordShotEdits(tx.editBatches, {
          projectId,
          summary: `${plan.keep.code} に ${String(plan.remove.length)} 件をまとめる`,
          entries: [editBatchEntry(plan.keep.id, shotBeforePatch(plan.keep, keepPatch))],
          shotEdits: plan.remove.map((removed) => ({ op: 'delete', shotId: removed.id })),
        })
        const kept = await tx.shots.update(plan.keep.id, keepPatch)
        for (const removed of plan.remove) await tx.shots.softDelete(removed.id)
        return kept
      })
      return c.json(
        ok({ shot: toShotResponse(merged), removedShotIds: plan.remove.map((removed) => removed.id) }),
        200,
      )
    })
