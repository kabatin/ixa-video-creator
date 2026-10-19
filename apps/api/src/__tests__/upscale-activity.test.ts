import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ModelId,
  ProviderId,
  ShotId,
  TakeId,
  UpscaleJobId,
  newId,
  type ProjectId,
  type UpscaleJob,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { upscaleActivityRoutes } from '../routes/upscale-activity.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 超解像の待ち・作成中の Shot（制作者 2026-10-19「Shot 一覧で、超解像の待ち・作成中の Shot がわかるように」）。
 * 超解像は Shot の状態を変えないので、生成中の印とは別に返す。時刻と見込みはサーバの記録から（開き直しても出せる）。
 */

const project = aProject()

const aJob = (patch: Partial<UpscaleJob> = {}): UpscaleJob => ({
  id: newId(UpscaleJobId),
  projectId: project.id,
  shotId: newId(ShotId),
  sourceTakeId: newId(TakeId),
  status: 'running',
  providerId: ProviderId.parse('vpipe'),
  modelId: ModelId.parse('vpipe/upscale'),
  takeId: null,
  providerJobRef: 'job-1',
  error: null,
  estimateSeconds: 240,
  providerRecord: null,
  queuedAt: new Date('2026-10-19T10:00:00Z'),
  startedAt: new Date('2026-10-19T10:00:05Z'),
  finishedAt: null,
  ...patch,
})

const build = (jobs: readonly UpscaleJob[]) => {
  const asked: ProjectId[] = []
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    upscaleActivityRoutes({
      projects: createInMemoryProjectRepository([project]),
      upscaleJobs: {
        findActiveByProject: (projectId) => {
          asked.push(projectId)
          return Promise.resolve([...jobs])
        },
      },
    }),
  )
  return { app, asked }
}

type Entry = {
  jobId: string
  shotId: string
  sourceTakeId: string
  status: string
  queuedAt: string
  startedAt: string | null
  estimateSeconds: number | null
}

describe('GET /projects/{projectId}/upscales/active', () => {
  it('動いている超解像の Shot・元の Take・状態・時刻・見込みを返す', async () => {
    const running = aJob()
    const waiting = aJob({ status: 'queued', startedAt: null, estimateSeconds: null, providerJobRef: null })
    const { app, asked } = build([running, waiting])

    const res = await app.request(`/projects/${project.id}/upscales/active`)

    expect(res.status).toBe(200)
    expect(asked).toEqual([project.id])
    const body = (await res.json()) as { data: Entry[] }
    expect(body.data).toEqual([
      {
        jobId: running.id,
        shotId: running.shotId,
        sourceTakeId: running.sourceTakeId,
        status: 'running',
        queuedAt: '2026-10-19T10:00:00.000Z',
        startedAt: '2026-10-19T10:00:05.000Z',
        estimateSeconds: 240,
      },
      {
        jobId: waiting.id,
        shotId: waiting.shotId,
        sourceTakeId: waiting.sourceTakeId,
        status: 'queued',
        queuedAt: '2026-10-19T10:00:00.000Z',
        startedAt: null,
        estimateSeconds: null,
      },
    ])
  })

  it('終わったジョブが混ざっても出さない', async () => {
    const { app } = build([aJob({ status: 'succeeded' }), aJob({ status: 'failed' }), aJob({ status: 'cancelled' })])
    const body = (await (await app.request(`/projects/${project.id}/upscales/active`)).json()) as { data: Entry[] }
    expect(body.data).toEqual([])
  })

  it('プロジェクトが無ければ 404', async () => {
    const { app, asked } = build([aJob()])
    const res = await app.request(`/projects/${aProject().id}/upscales/active`)
    expect(res.status).toBe(404)
    expect(asked).toEqual([])
  })
})
