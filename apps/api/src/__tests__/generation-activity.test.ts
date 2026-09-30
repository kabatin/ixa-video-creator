import { OpenAPIHono } from '@hono/zod-openapi'
import {
  GenerationJobId,
  ModelId,
  ShotId,
  newId,
  type GenerationJob,
  type ProjectId,
} from '@ixa/domain'
import { createProviderRegistry } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { generationActivityRoutes } from '../routes/generation-activity.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createTestVideoProvider, testModel } from './test-video-provider.js'

/**
 * 生成中の Shot で、いま何が起きているか（制作者 2026-09-30「生成中です、と出ているだけでわかりづらい」）。
 * **どのモデルで・順番待ちか作成中か・いつから・目安は何秒か**を返す。画面を開き直しても出せるよう、時刻はサーバの記録から。
 */

const project = aProject()
const MINIMAX = testModel({
  id: 'vpipe/minimax-h3-turbo-draft',
  providerId: 'vpipe',
  typicalLatencySec: 210,
})

const aJob = (patch: Partial<GenerationJob> = {}): GenerationJob => ({
  id: newId(GenerationJobId),
  shotId: newId(ShotId),
  specHash: 'a'.repeat(64),
  requestedModel: 'AUTO',
  resolvedModel: ModelId.parse('vpipe/minimax-h3-turbo-draft'),
  routerDecision: null,
  status: 'running',
  attempt: 1,
  providerJobRef: null,
  error: null,
  parentTakeId: null,
  regenerationReason: null,
  corrections: [],
  queuedAt: new Date('2026-09-30T10:00:00Z'),
  startedAt: new Date('2026-09-30T10:00:05Z'),
  finishedAt: null,
  ...patch,
})

const build = (jobs: readonly GenerationJob[]) => {
  const asked: ProjectId[] = []
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    generationActivityRoutes({
      projects: createInMemoryProjectRepository([project]),
      activeJobs: (projectId) => {
        asked.push(projectId)
        return Promise.resolve([...jobs])
      },
      registry: createProviderRegistry([createTestVideoProvider([MINIMAX])]),
    }),
  )
  return { app, asked }
}

type Body = {
  data: {
    shotId: string
    status: string
    modelLabel: string | null
    typicalLatencySec: number | null
    queuedAt: string
    startedAt: string | null
  }[]
}

describe('GET /projects/:projectId/generations/active', () => {
  it('動いている生成を、モデルの名前・目安の秒・始まった時刻つきで返す', async () => {
    const job = aJob()
    const { app, asked } = build([job])

    const response = await app.request(`/projects/${project.id}/generations/active`)
    const body = (await response.json()) as Body

    expect(response.status).toBe(200)
    expect(asked).toEqual([project.id])
    expect(body.data).toEqual([
      {
        jobId: job.id,
        shotId: job.shotId,
        status: 'running',
        modelId: 'vpipe/minimax-h3-turbo-draft',
        modelLabel: 'vpipe/minimax-h3-turbo-draft',
        typicalLatencySec: 210,
        queuedAt: '2026-09-30T10:00:00.000Z',
        startedAt: '2026-09-30T10:00:05.000Z',
        attempt: 1,
      },
    ])
  })

  it('モデルがまだ決まっていない・この環境に無いときは、名前と目安を null にする（推し量らない）', async () => {
    const { app } = build([
      aJob({ status: 'queued', resolvedModel: null, startedAt: null }),
      aJob({ resolvedModel: ModelId.parse('gone/model') }),
    ])

    const body = (await (
      await app.request(`/projects/${project.id}/generations/active`)
    ).json()) as Body

    expect(
      body.data.map((entry) => [entry.status, entry.modelLabel, entry.typicalLatencySec]),
    ).toEqual([
      ['queued', null, null],
      ['running', null, null],
    ])
  })

  it('無いプロジェクトは 404', async () => {
    const { app } = build([])

    expect((await app.request(`/projects/${aProject().id}/generations/active`)).status).toBe(404)
  })
})
