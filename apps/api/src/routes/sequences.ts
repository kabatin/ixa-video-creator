import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository, SequenceRepository } from '@ixa/db'
import {
  CreateSequenceInput as CreateSequenceInputSchema,
  ProjectId as ProjectIdSchema,
  Sequence as SequenceSchema,
  SequenceId as SequenceIdSchema,
  UpdateSequencePatch as UpdateSequencePatchSchema,
  type ProjectId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * Sequence（Aメロ / サビ といった楽曲構成のまとまり）の CRUD（DOMAIN.md §8）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 */

export const SequenceResponse = SequenceSchema.openapi('Sequence')

/**
 * projectId は経路が持つので本文には含めない。正が 2 つになるのを避ける。
 * musicSectionLabel は MusicSection との紐付けが任意なので、省略を null として受ける。
 */
const CreateSequenceBody = CreateSequenceInputSchema.omit({ projectId: true })
  .extend({ musicSectionLabel: z.string().nullable().default(null) })
  .openapi('CreateSequenceInput')
const UpdateSequenceBody = UpdateSequencePatchSchema.openapi('UpdateSequencePatch')

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})
const SequenceParams = z.object({
  id: SequenceIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const body = <T extends z.ZodTypeAny>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}

const listSequencesRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/sequences', tags: ['sequences'],
  summary: 'Project の Sequence 一覧（order 昇順）',
  request: { params: ProjectParams },
  responses: {
    200: jsonContent('Sequence 一覧', listResponse(SequenceResponse)),
    ...commonErrors,
  },
})

const createSequenceRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/sequences', tags: ['sequences'],
  summary: 'Sequence を作成する',
  request: { params: ProjectParams, body: body(CreateSequenceBody) },
  responses: {
    201: jsonContent('作成された Sequence', successResponse(SequenceResponse)),
    ...commonErrors,
  },
})

const updateSequenceRoute = createRoute({
  method: 'patch', path: '/sequences/{id}', tags: ['sequences'],
  summary: 'Sequence を部分更新する',
  request: { params: SequenceParams, body: body(UpdateSequenceBody) },
  responses: {
    200: jsonContent('更新後の Sequence', successResponse(SequenceResponse)),
    ...commonErrors,
  },
})

const deleteSequenceRoute = createRoute({
  method: 'delete', path: '/sequences/{id}', tags: ['sequences'],
  summary: 'Sequence をソフトデリートする',
  request: { params: SequenceParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

export type SequenceRoutesDeps = {
  sequences: SequenceRepository
  /** Project の実在確認だけに使う。 */
  projects: ProjectRepository
}

export const sequenceRoutes = (deps: SequenceRoutesDeps) => {
  const projectMissing = async (projectId: ProjectId): Promise<boolean> =>
    (await deps.projects.findById(projectId)) === null

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listSequencesRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(okList(await deps.sequences.findByProject(projectId)), 200)
    })
    .openapi(createSequenceRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if (await projectMissing(projectId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const created = await deps.sequences.create({ ...c.req.valid('json'), projectId })
      return c.json(ok(created), 201)
    })
    .openapi(updateSequenceRoute, async (c) => {
      /**
       * 存在しなければリポジトリが DbNotFoundError を投げ、共通ハンドラが 404 にする。
       * ここで catch しないのは意図的で、**畳んでよい既知の失敗が他に無い**ため。
       * 例外を丸ごと捕まえると、DB 障害まで入力ミスとして返してしまう。
       */
      const updated = await deps.sequences.update(c.req.valid('param').id, c.req.valid('json'))
      return c.json(ok(updated), 200)
    })
    .openapi(deleteSequenceRoute, async (c) => {
      await deps.sequences.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
}
