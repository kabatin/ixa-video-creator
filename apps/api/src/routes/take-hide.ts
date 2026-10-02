import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { DbNotFoundError } from '@ixa/db'
import { TakeId as TakeIdSchema, shotStatusAfterCancel } from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { ShotResponse, publishShotStatus, toShotResponse, type ShotRoutesDeps } from './shots.js'

/**
 * Take を消す（制作者 2026-10-01「Takeを消す口」）。
 *
 * Take は作り直しても消さない約束（ADR-0003。行も消さない）なので、**見えなくする**（`deleted_at`）。
 * 中身は変えず、記録・素材・費用は残る。一覧・比較・採用・Shot の状態の判断から外れる。
 * 採用中の Take は断る（タイムラインと書き出しが使っている）。
 */

export const ADOPTED_TAKE_CANNOT_HIDE = '採用中の Take は消せません。先に採用を外してください。'

export type TakeHideDeps = Pick<ShotRoutesDeps, 'shots' | 'takes' | 'events' | 'logger'>

const HideData = z.object({ shot: ShotResponse }).openapi('HideTakeResult')

const hideRoute = createRoute({
  method: 'delete',
  path: '/takes/{id}',
  tags: ['shots'],
  summary: 'Take を見えなくする（行も中身も残る。採用中は断る）',
  request: { params: z.object({ id: TakeIdSchema.openapi({ param: { name: 'id', in: 'path' } }) }) },
  responses: {
    200: {
      description: '見えなくした。決め直した Shot を返す',
      content: { 'application/json': { schema: successResponse(HideData) } },
    },
    404: errorContent('Take が無い・もう見えない'),
    409: errorContent('採用中の Take'),
  },
})

export const takeHideRoutes = (deps: TakeHideDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(hideRoute, async (c) => {
    const take = await deps.takes.findById(c.req.valid('param').id)
    if (take === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const shot = await deps.shots.findById(take.shotId)
    if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    if (shot.selectedTakeId === take.id) return c.json(fail(ADOPTED_TAKE_CANNOT_HIDE), 409)

    try {
      await deps.takes.hide(take.id, new Date())
    } catch (error) {
      // 同時に消された。もう見えないので 404 と同じ。
      if (error instanceof DbNotFoundError) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      throw error
    }

    // 生成中なら状態はそちらの決着に任せる。そうでなければ残りの Take で決め直す
    // （最後の 1 本を消したら下書き。人が減らしたので、失敗の痕跡を残す「要判断」にはしない）。
    if (shot.status === 'generating') return c.json(ok({ shot: toShotResponse(shot) }), 200)
    const remaining = await deps.takes.findByShot(shot.id)
    const next = shotStatusAfterCancel({
      hasSelectedTake: shot.selectedTakeId !== null,
      hasTakes: remaining.length > 0,
    })
    if (next === shot.status) return c.json(ok({ shot: toShotResponse(shot) }), 200)
    const moved = await deps.shots.updateStatus(shot.id, next)
    await publishShotStatus(deps, moved)
    return c.json(ok({ shot: toShotResponse(moved) }), 200)
  })
