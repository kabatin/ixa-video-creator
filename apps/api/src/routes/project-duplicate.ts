import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  DuplicateProjectRequest,
  ProjectId as ProjectIdSchema,
  duplicationProblem,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import type { ProjectDuplicationDeps } from '../project-duplication/deps.js'
import { duplicateProject } from '../project-duplication/duplicate.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { ProjectResponse, toProjectResponse } from './projects.js'

/**
 * 作品を複製する（制作者 2026-10-04。ADR-0037）。持っていく項目を選べる。
 * 依存（歌詞の時刻 ← 楽曲と作品の方針、絵コンテ・絵・Take ← Shot）が欠けた選び方は断り、何も作らない。
 */

export type ProjectDuplicateRoutesDeps = ProjectDuplicationDeps

const DuplicateResult = z
  .object({
    project: ProjectResponse,
    /** 外したものの知らせ（例: 登場人物を外した Shot の数）。何も外していなければ空。 */
    notes: z.array(z.string()),
  })
  .openapi('DuplicatedProject')

const duplicateRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/duplicate',
  tags: ['projects'],
  summary: '作品を複製する（持っていく項目を選べる）',
  request: {
    params: z.object({ projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }) }),
    body: { required: true, content: { 'application/json': { schema: DuplicateProjectRequest.openapi('DuplicateProjectBody') } } },
  },
  responses: {
    201: {
      description: '複製した作品と、外したものの知らせ',
      content: { 'application/json': { schema: successResponse(DuplicateResult) } },
    },
    404: errorContent('元の作品が存在しない'),
    422: errorContent('名前が空・選び方が矛盾している（何も作っていない）'),
    500: errorContent('途中で失敗した（作りかけの作品は消してある）'),
  },
})

export const projectDuplicateRoutes = (deps: ProjectDuplicateRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(duplicateRoute, async (c) => {
    const source = await deps.projects.findById(c.req.valid('param').projectId)
    if (source === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    const request = c.req.valid('json')
    const problem = duplicationProblem(request.items)
    if (problem !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, { items: [problem] }), 422)

    const duplicated = await duplicateProject(deps, source, request)
    return c.json(ok({ project: toProjectResponse(duplicated.project), notes: [...duplicated.notes] }), 201)
  })
