import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { WorkspaceId as WorkspaceIdSchema } from '@ixa/domain'
import {
  DEMO_UNAVAILABLE_MESSAGE,
  DEMO_WORKSPACE_MISSING_MESSAGE,
  DemoUnavailableError,
  DemoWorkspaceMissingError,
  demoFailureMessage,
  demoFailureReason,
} from '../demo-project/errors.js'
import type { DemoInstaller } from '../demo-project/installer.js'
import { validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'
import { ProjectResponse, toProjectResponse } from './projects.js'

/**
 * 同梱の見本の作品（ADR-0067）。`GET` で入れられるか（と入っている作品）を見て、`POST` で入れる。
 * **`/projects/{id}` より先に登録する**（`demo` を作品の ID として読ませない。`app.ts`）。
 */

export type ProjectDemoRoutesDeps = { readonly installer: DemoInstaller }

const DemoStatusResponse = z
  .object({
    available: z.boolean(),
    title: z.string().nullable(),
    totalBytes: z.number().int().nonnegative().nullable(),
    project: ProjectResponse.nullable(),
  })
  .openapi('DemoStatus')

const DemoInstallResponse = z.object({ project: ProjectResponse, created: z.boolean() }).openapi('DemoInstalled')

const statusRoute = createRoute({
  method: 'get',
  path: '/projects/demo',
  tags: ['projects'],
  summary: '見本の作品を入れられるか・入っている見本の作品',
  request: {
    query: z.object({ workspaceId: WorkspaceIdSchema.openapi({ param: { name: 'workspaceId', in: 'query' } }) }),
  },
  responses: {
    200: { description: '見本の状態', content: { 'application/json': { schema: successResponse(DemoStatusResponse) } } },
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('見本の目録を読めなかった'),
  },
})

const installRoute = createRoute({
  method: 'post',
  path: '/projects/demo',
  tags: ['projects'],
  summary: '見本の作品を入れる（入っていれば、それを返す）',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: z.object({ workspaceId: WorkspaceIdSchema }).openapi('InstallDemoBody') } },
    },
  },
  responses: {
    200: { description: 'もう入っていた見本の作品', content: { 'application/json': { schema: successResponse(DemoInstallResponse) } } },
    201: { description: '入れた見本の作品', content: { 'application/json': { schema: successResponse(DemoInstallResponse) } } },
    404: errorContent('見本がまだ用意されていない・作業場所が無い（何も取りに行っていない）'),
    409: errorContent('この機械の同じ名札の素材の中身が、見本と食い違う（何も作っていない）'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('入れられなかった（作りかけの作品は消してある）'),
    502: errorContent('見本のファイルを取れなかった・壊れていた（何も作っていない）'),
  },
})

export const projectDemoRoutes = (deps: ProjectDemoRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(statusRoute, async (c) => {
      const status = await deps.installer.status(c.req.valid('query').workspaceId)
      return c.json(ok({ ...status, project: status.project === null ? null : toProjectResponse(status.project) }), 200)
    })
    .openapi(installRoute, async (c) => {
      try {
        const result = await deps.installer.install(c.req.valid('json').workspaceId)
        return c.json(ok({ project: toProjectResponse(result.project), created: result.created }), result.created ? 201 : 200)
      } catch (error) {
        // 文脈は入れる口がログに残している。ここでは理由ごとの文だけを返す（URL・ID・番号を入れない）。
        if (error instanceof DemoUnavailableError) return c.json(fail(DEMO_UNAVAILABLE_MESSAGE), 404)
        if (error instanceof DemoWorkspaceMissingError) return c.json(fail(DEMO_WORKSPACE_MISSING_MESSAGE), 404)
        const reason = demoFailureReason(error)
        if (reason === 'conflict') return c.json(fail(demoFailureMessage(error)), 409)
        return c.json(fail(demoFailureMessage(error)), reason === 'network' || reason === 'broken' ? 502 : 500)
      }
    })
