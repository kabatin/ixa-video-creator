import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository, UpscaleJobRepository } from '@ixa/db'
import { ProjectId } from '@ixa/domain'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 超解像の待ち・作成中の Shot（制作者 2026-10-19「Shot 一覧で、超解像の待ち・作成中の Shot がわかるように」）。
 *
 * 超解像は Shot の状態を変えないので、生成中の印（`generation-activity.ts`）とは別に返す。
 * **時刻と見込みはサーバの記録**なので、画面を開き直しても経過が出せる。
 */

const ActiveUpscale = z
  .object({
    jobId: z.string(),
    shotId: z.string(),
    /** 元にする Take。 */
    sourceTakeId: z.string(),
    /** queued = 順番待ち（生成先へまだ送っていない）、running = 生成先へ送った。 */
    status: z.enum(['queued', 'running']),
    queuedAt: z.string(),
    /** 生成先へ送った時刻。 */
    startedAt: z.string().nullable(),
    /** 生成先が投入時に返した見込み（秒）。返さないサーバ・送る前は null。 */
    estimateSeconds: z.number().nonnegative().nullable(),
  })
  .openapi('ActiveUpscale')

const activeRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/upscales/active',
  tags: ['shots'],
  summary: 'プロジェクトで動いている超解像（順番待ち・作成中）',
  request: { params: z.object({ projectId: ProjectId }) },
  responses: {
    200: {
      description: '動いている超解像',
      content: { 'application/json': { schema: successResponse(z.array(ActiveUpscale)) } },
    },
    404: errorContent('プロジェクトが存在しない'),
  },
})

export type UpscaleActivityDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly upscaleJobs: Pick<UpscaleJobRepository, 'findActiveByProject'>
}

export const upscaleActivityRoutes = (deps: UpscaleActivityDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(activeRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const jobs = await deps.upscaleJobs.findActiveByProject(projectId)
    const entries = jobs.flatMap((job) =>
      job.status === 'queued' || job.status === 'running'
        ? [
            {
              jobId: job.id,
              shotId: job.shotId,
              sourceTakeId: job.sourceTakeId,
              status: job.status,
              queuedAt: job.queuedAt.toISOString(),
              startedAt: job.startedAt?.toISOString() ?? null,
              estimateSeconds: job.estimateSeconds,
            },
          ]
        : [],
    )
    return c.json(ok(entries), 200)
  })
