import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { EditTransaction } from '@ixa/db'
import {
  CreateShotInput as CreateShotInputSchema,
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  TakeId as TakeIdSchema,
  UpdateShotPatch as UpdateShotPatchSchema,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { locationProblem } from './library-ownership.js'
import { recordShotPatch, recordTakeChoice } from './shot-edit-recording.js'
import { ShotResponse, applySelectedTake, clearSelectedTake, toShotResponse, type ShotRoutesDeps } from './shots.js'

/**
 * Shot 1 件の作成・直し・削除と、採用 Take の決定・外し（`shots.ts` から分けた。2026-10-19）。
 * **直し・採用は、書く前に、書き込みと同じトランザクションで記録する**（取り消し）。
 * 書き込みが落ちれば（コードの衝突・途中で消された）記録も残らず、⌘Z が空振りしない。
 */

const ShotParams = z.object({
  id: ShotIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})
const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const SelectTakeBody = z.object({ takeId: TakeIdSchema }).openapi('SelectTakeInput')

const CreateShotBody = CreateShotInputSchema.omit({ projectId: true }).openapi('CreateShotInput')
/**
 * 後から直せる列。
 *
 * `code` と `mood` も直せる。ストーリーボードの一括作成は `VERSE-01` のような
 * 機械的なコードと空の `mood` を付けるので、**後から直せないと直す手段が無い**。
 * `selectedTakeId` と `status` は専用の口があるので含めない（不変条件を伴う更新を
 * 汎用の patch で素通りさせないため）。
 */
const UpdateShotBody = UpdateShotPatchSchema.pick({
  code: true,
  description: true,
  mood: true,
  continuityMode: true,
  camera: true,
  sourceType: true,
  startSec: true,
  durationSec: true,
  sourceInSec: true,
  // Take を尺に合わせて速度を変えるか（ADR-0026）。
  timing: true,
  // 再生の速さ（ADR-0050）。trim の Shot だけが使う。
  speed: true,
  // 場所は後から決められる。null を送れば外す（ADR-0015）。
  locationId: true,
}).openapi('UpdateShotPatch')

/**
 * PostgreSQL の一意制約違反かどうか。
 * **エラーの型で判定せず code で見る。** drizzle は driver の例外を包んで投げるため、
 * instanceof では捕まえられない（実際に包まれていることを確認済み）。
 */
const isUniqueViolation = (error: unknown): boolean => {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    if (typeof current === 'object' && 'code' in current && current.code === '23505') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

/** `(project_id, code)` は UNIQUE。衝突は利用者の入力ミスなので 422 で返す。 */
export const DUPLICATE_SHOT_CODE_MESSAGE = 'このコードは同じ Project の別の Shot が使っています'

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}

const createShotRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/shots',
  tags: ['shots'],
  summary: 'Shot を作成する',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: CreateShotBody } } },
  },
  responses: {
    201: jsonContent('作成された Shot', successResponse(ShotResponse)),
    ...commonErrors,
  },
})

const updateShotRoute = createRoute({
  method: 'patch',
  path: '/shots/{id}',
  tags: ['shots'],
  summary: 'Shot を部分更新する',
  request: {
    params: ShotParams,
    body: { required: true, content: { 'application/json': { schema: UpdateShotBody } } },
  },
  responses: { 200: jsonContent('更新後の Shot', successResponse(ShotResponse)), ...commonErrors },
})

const deleteShotRoute = createRoute({
  method: 'delete',
  path: '/shots/{id}',
  tags: ['shots'],
  summary: 'Shot をソフトデリートする',
  request: { params: ShotParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

const selectTakeRoute = createRoute({
  method: 'post',
  path: '/shots/{id}/select-take',
  tags: ['shots'],
  summary: '採用 Take を決める',
  request: {
    params: ShotParams,
    body: { required: true, content: { 'application/json': { schema: SelectTakeBody } } },
  },
  responses: { 200: jsonContent('更新後の Shot', successResponse(ShotResponse)), ...commonErrors },
})

const unselectTakeRoute = createRoute({
  method: 'delete',
  path: '/shots/{id}/selected-take',
  tags: ['shots'],
  summary: '採用 Take を外す（Take そのものは消さない）',
  request: { params: ShotParams },
  responses: { 200: jsonContent('更新後の Shot', successResponse(ShotResponse)), ...commonErrors },
})

export type ShotSingleEditDeps = Pick<ShotRoutesDeps, 'shots' | 'takes' | 'locations' | 'events' | 'logger'> & {
  /** 記録と書き込みを同じトランザクションで行う口。**省けない。** */
  readonly transaction: EditTransaction
}

export const shotSingleEditRoutes = (deps: ShotSingleEditDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(createShotRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      const input = c.req.valid('json')
      const problem = await locationProblem(deps.locations, projectId, input.locationId)
      if (problem !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, { locationId: [problem] }), 422)
      const created = await deps.shots.create({ ...input, projectId })
      return c.json(ok(toShotResponse(created)), 201)
    })
    .openapi(updateShotRoute, async (c) => {
      const patch = c.req.valid('json')
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      if (patch.locationId !== undefined && patch.locationId !== null) {
        const problem = await locationProblem(deps.locations, shot.projectId, patch.locationId)
        if (problem !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, { locationId: [problem] }), 422)
      }

      /**
       * コードの重複は `(project_id, code)` の UNIQUE が弾く。
       * **DB の例外をそのまま 500 にしない。** 利用者の入力ミスなので、
       * 何が悪いか分かる 422 にする。他の Shot を読み比べるより、
       * 制約に任せて衝突だけを畳むほうが競合に強い。
       */
      try {
        // 記録と書き込みは同じトランザクション。コードの衝突で書き込みが落ちれば、記録も残らない。
        const updated = await deps.transaction(async (tx) => {
          await recordShotPatch(tx.editBatches, shot, patch)
          return tx.shots.update(shot.id, patch)
        })
        return c.json(ok(toShotResponse(updated)), 200)
      } catch (error) {
        if (patch.code !== undefined && isUniqueViolation(error)) {
          return c.json(
            fail(VALIDATION_ERROR_MESSAGE, { code: [DUPLICATE_SHOT_CODE_MESSAGE] }),
            422,
          )
        }
        throw error
      }
    })
    .openapi(deleteShotRoute, async (c) => {
      await deps.shots.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
    .openapi(selectTakeRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const take = await deps.takes.findById(c.req.valid('json').takeId)
      // 他 Shot の Take を採用させない。Take は Shot に属する（DOMAIN.md §10）。
      if (take === null || take.shotId !== shot.id) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { takeId: ['この Shot に属する Take ではありません'] }),
          422,
        )
      }

      const updated = await deps.transaction(async (tx) => {
        await recordTakeChoice(tx.editBatches, shot, 'select')
        return applySelectedTake({ ...deps, shots: tx.shots }, shot.id, take)
      })
      return c.json(ok(toShotResponse(updated)), 200)
    })
    .openapi(unselectTakeRoute, async (c) => {
      const shot = await deps.shots.findById(c.req.valid('param').id)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const updated = await deps.transaction(async (tx) => {
        if (shot.selectedTakeId !== null) await recordTakeChoice(tx.editBatches, shot, 'unselect')
        return clearSelectedTake({ ...deps, shots: tx.shots }, shot)
      })
      return c.json(ok(toShotResponse(updated)), 200)
    })
