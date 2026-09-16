import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository } from '@ixa/db'
import {
  CreateProjectInput as CreateProjectInputSchema,
  Project as ProjectSchema,
  ProjectId as ProjectIdSchema,
  UpdateProjectPatch as UpdateProjectPatchSchema,
  WorkspaceId as WorkspaceIdSchema,
  type Project,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * Project の CRUD。ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 * 返すのは Domain 型を JSON へ写した DTO のみ。drizzle の row 型は API に出さない。
 */

/**
 * API が返す Project。Domain の `Project` と同じ形だが、
 * 日時は JSON で表現できる ISO8601 文字列にする。
 */
export const ProjectResponse = ProjectSchema.omit({ createdAt: true, updatedAt: true })
  .extend({
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Project')
export type ProjectResponse = z.infer<typeof ProjectResponse>

/** Domain の Project を API の DTO へ写す（新しいオブジェクトを返す）。 */
export const toProjectResponse = (project: Project): ProjectResponse => ({
  ...project,
  createdAt: project.createdAt.toISOString(),
  updatedAt: project.updatedAt.toISOString(),
})

const CreateProjectBody = CreateProjectInputSchema.openapi('CreateProjectInput')
const UpdateProjectBody = UpdateProjectPatchSchema.openapi('UpdateProjectPatch')

const ProjectParams = z.object({
  id: ProjectIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

const ListProjectsQuery = z.object({
  workspaceId: WorkspaceIdSchema.openapi({ param: { name: 'workspaceId', in: 'query' } }),
})

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const createProjectRoute = createRoute({
  method: 'post',
  path: '/projects',
  tags: ['projects'],
  summary: 'プロジェクトを作成する',
  request: {
    body: { required: true, content: { 'application/json': { schema: CreateProjectBody } } },
  },
  responses: {
    201: jsonContent('作成されたプロジェクト', successResponse(ProjectResponse)),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const listProjectsRoute = createRoute({
  method: 'get',
  path: '/projects',
  tags: ['projects'],
  summary: 'ワークスペース内のプロジェクト一覧',
  request: { query: ListProjectsQuery },
  responses: {
    200: jsonContent('プロジェクト一覧', listResponse(ProjectResponse)),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const getProjectRoute = createRoute({
  method: 'get',
  path: '/projects/{id}',
  tags: ['projects'],
  summary: 'プロジェクトを 1 件取得する',
  request: { params: ProjectParams },
  responses: {
    200: jsonContent('プロジェクト', successResponse(ProjectResponse)),
    404: errorContent('プロジェクトが存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const updateProjectRoute = createRoute({
  method: 'patch',
  path: '/projects/{id}',
  tags: ['projects'],
  summary: 'プロジェクトを部分更新する',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: UpdateProjectBody } } },
  },
  responses: {
    200: jsonContent('更新後のプロジェクト', successResponse(ProjectResponse)),
    404: errorContent('プロジェクトが存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const deleteProjectRoute = createRoute({
  method: 'delete',
  path: '/projects/{id}',
  tags: ['projects'],
  summary: 'プロジェクトをソフトデリートする',
  request: { params: ProjectParams },
  responses: {
    204: { description: '削除した（本文なし）' },
    404: errorContent('プロジェクトが存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

export type ProjectRoutesDeps = { projects: ProjectRepository }

export const projectRoutes = ({ projects }: ProjectRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(createProjectRoute, async (c) => {
      const created = await projects.create(c.req.valid('json'))
      return c.json(ok(toProjectResponse(created)), 201)
    })
    .openapi(listProjectsRoute, async (c) => {
      const { workspaceId } = c.req.valid('query')
      const found = await projects.findByWorkspace(workspaceId)
      return c.json(okList(found.map(toProjectResponse)), 200)
    })
    .openapi(getProjectRoute, async (c) => {
      const found = await projects.findById(c.req.valid('param').id)
      if (found === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }
      return c.json(ok(toProjectResponse(found)), 200)
    })
    .openapi(updateProjectRoute, async (c) => {
      const updated = await projects.update(c.req.valid('param').id, c.req.valid('json'))
      return c.json(ok(toProjectResponse(updated)), 200)
    })
    .openapi(deleteProjectRoute, async (c) => {
      await projects.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
