import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { ProjectRepository } from '@ixa/db'
import { ProjectId, type GenerationJob, type ModelId } from '@ixa/domain'
import type { ProviderRegistry, VideoModelDescriptor } from '@ixa/provider-core'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 生成中の Shot で、いま何が起きているか（制作者 2026-09-30「生成中です、と出ているだけでわかりづらい」）。
 *
 * どのモデルで・順番待ちか作成中か・いつから・目安は何秒かを返す。**時刻はサーバの記録**なので、
 * 画面を開き直しても経過が出せる。モデルが決まっていない・この環境に無いときは名前と目安を null にする（推し量らない）。
 */

const ActiveGeneration = z
  .object({
    jobId: z.string(),
    shotId: z.string(),
    /** queued = 順番待ち（生成先へまだ送っていない）、running = 生成先へ送った。 */
    status: z.enum(['queued', 'running']),
    modelId: z.string().nullable(),
    modelLabel: z.string().nullable(),
    /** モデルが宣言する 1 本あたりの目安（秒）。 */
    typicalLatencySec: z.number().nonnegative().nullable(),
    queuedAt: z.string(),
    startedAt: z.string().nullable(),
    attempt: z.number().int().positive(),
  })
  .openapi('ActiveGeneration')

const activeRoute = createRoute({
  method: 'get',
  path: '/projects/{projectId}/generations/active',
  tags: ['shots'],
  summary: 'プロジェクトで動いている生成（順番待ち・作成中）',
  request: { params: z.object({ projectId: ProjectId }) },
  responses: {
    200: {
      description: '動いている生成',
      content: { 'application/json': { schema: successResponse(z.array(ActiveGeneration)) } },
    },
    404: errorContent('プロジェクトが存在しない'),
  },
})

export type GenerationActivityDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  /** 生きている Shot の、状態が queued / running のジョブ。 */
  readonly activeJobs: (projectId: ProjectId) => Promise<readonly GenerationJob[]>
  readonly registry: ProviderRegistry
}

const modelOf = (
  registry: ProviderRegistry,
  modelId: ModelId | null,
): VideoModelDescriptor | null => {
  if (modelId === null) return null
  return registry.allModels().find((model) => model.id === modelId) ?? null
}

export const generationActivityRoutes = (deps: GenerationActivityDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(activeRoute, async (c) => {
    const { projectId } = c.req.valid('param')
    if ((await deps.projects.findById(projectId)) === null)
      return c.json(fail(NOT_FOUND_MESSAGE), 404)
    const jobs = await deps.activeJobs(projectId)
    const entries = jobs.flatMap((job) => {
      if (job.status !== 'queued' && job.status !== 'running') return []
      const model = modelOf(deps.registry, job.resolvedModel)
      return [
        {
          jobId: job.id,
          shotId: job.shotId,
          status: job.status,
          modelId: job.resolvedModel,
          modelLabel: model?.label ?? null,
          typicalLatencySec: model?.economics.typicalLatencySec ?? null,
          queuedAt: job.queuedAt.toISOString(),
          startedAt: job.startedAt?.toISOString() ?? null,
          attempt: job.attempt,
        },
      ]
    })
    return c.json(ok(entries), 200)
  })
