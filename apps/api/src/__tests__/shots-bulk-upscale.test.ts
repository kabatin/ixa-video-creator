import { OpenAPIHono } from '@hono/zod-openapi'
import { UPSCALE_EXISTS_REASON, UPSCALE_REASON, type Shot } from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
  createInMemoryUpscaleJobRepository,
} from '@ixa/generation/testing'
import type { VideoUpscaler } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { NO_SELECTED_TAKE_REASON } from '../routes/shots-bulk-final.js'
import { shotBulkUpscaleRoutes } from '../routes/shots-bulk-upscale.js'
import { UPSCALE_UNSUPPORTED_MESSAGE } from '../routes/take-upscale.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 採用中の Take をまとめて解像度を上げる（ADR-0044）。
 *
 * 上げられるかの規則は 1 本ずつの口と同じ domain の `upscaleBlocker`。
 * ここでは「選んだ Shot の**採用中の** Take を積む」「飛ばすものは理由つき」「下見は積まない」を見る。
 */

const stubUpscaler = (available = true): VideoUpscaler => ({
  providerId: 'vpipe' as VideoUpscaler['providerId'],
  modelId: 'vpipe/flashvsr-upscale' as VideoUpscaler['modelId'],
  available: () => Promise.resolve(available),
  submit: () => Promise.reject(new Error('API からは投入しない')),
  poll: () => Promise.reject(new Error('API からは問い合わせない')),
  cancel: () => Promise.resolve(),
})

const buildFixture = async (options: { readonly upscaler?: VideoUpscaler | null } = {}) => {
  const project = aProject()
  const takes = createInMemoryTakeRepository()
  const base = [
    aShot(project.id, { code: 'CUT-01', order: 1000 }),
    aShot(project.id, { code: 'CUT-02', order: 2000 }),
    aShot(project.id, { code: 'CUT-03', order: 3000 }),
  ]
  const [adopted, upscaled, unadopted] = await Promise.all(
    base.map((shot, i) => takes.create(aTake(shot, String(i + 1).repeat(64)))),
  )
  if (adopted === undefined || upscaled === undefined || unadopted === undefined) {
    throw new Error('fixture の Take が作れませんでした')
  }
  /** CUT-02 は上げたものを採用済み。元を指す親を持たせる。 */
  const upscaledResult = await takes.create(
    aTake(base[1] as Shot, 'f'.repeat(64), {
      parentTakeId: upscaled.id,
      regenerationReason: UPSCALE_REASON,
    }),
  )
  const shots = [
    { ...(base[0] as Shot), selectedTakeId: adopted.id },
    { ...(base[1] as Shot), selectedTakeId: upscaled.id },
    { ...(base[2] as Shot), selectedTakeId: null },
  ]
  const upscaleJobs = createInMemoryUpscaleJobRepository()
  const enqueued: string[] = []

  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    shotBulkUpscaleRoutes({
      shots: createInMemoryShotRepository(shots),
      takes,
      projects: createInMemoryProjectRepository([project]),
      upscaleJobs,
      upscaleQueue: {
        enqueue: (id) => {
          enqueued.push(id)
          return Promise.resolve()
        },
      },
      upscaler: options.upscaler === undefined ? stubUpscaler() : options.upscaler,
      events: createInMemoryProjectEvents(),
      logger: createLogger('silent'),
    }),
  )

  const send = (shotIds: readonly string[], dryRun: boolean) =>
    app.request(`/projects/${project.id}/shots/bulk/upscale`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shotIds, dryRun }),
    })

  return { send, shots, adopted, upscaledResult, upscaleJobs, enqueued: () => enqueued }
}

type Body = {
  readonly data: {
    readonly results: readonly ({ shotId: string; ok: true; jobId: string | null } | { shotId: string; ok: false; reason: string })[]
    readonly enqueuedCount: number
    readonly dryRun: boolean
  }
}

describe('POST /projects/:projectId/shots/bulk/upscale', () => {
  it('採用中の Take だけを積み、積めないものは理由つきで返す', async () => {
    const f = await buildFixture()

    const res = await f.send(f.shots.map((shot) => shot.id), false)

    expect(res.status).toBe(202)
    const { data } = (await res.json()) as Body
    const [job] = f.upscaleJobs.snapshot()
    expect(f.upscaleJobs.snapshot()).toHaveLength(1)
    expect(job).toMatchObject({ sourceTakeId: f.adopted.id, status: 'queued' })
    expect(f.enqueued()).toEqual([job?.id])
    expect(data.enqueuedCount).toBe(1)
    expect(data.results).toEqual([
      { shotId: f.shots[0]?.id, ok: true, jobId: job?.id },
      { shotId: f.shots[1]?.id, ok: false, reason: UPSCALE_EXISTS_REASON },
      { shotId: f.shots[2]?.id, ok: false, reason: NO_SELECTED_TAKE_REASON },
    ])
  })

  /** 押す前の下見。**1 件も積まない。** */
  it('下見は積まない', async () => {
    const f = await buildFixture()

    const res = await f.send(f.shots.map((shot) => shot.id), true)

    expect(res.status).toBe(200)
    const { data } = (await res.json()) as Body
    expect(f.upscaleJobs.snapshot()).toEqual([])
    expect(f.enqueued()).toEqual([])
    expect(data).toMatchObject({ enqueuedCount: 0, dryRun: true })
    expect(data.results[0]).toEqual({ shotId: f.shots[0]?.id, ok: true, jobId: null })
  })

  it('二度押しでは二重に積まない', async () => {
    const f = await buildFixture()
    await f.send([f.shots[0]?.id ?? ''], false)

    const again = await f.send([f.shots[0]?.id ?? ''], false)

    const { data } = (await again.json()) as Body
    expect(data.enqueuedCount).toBe(0)
    expect(f.upscaleJobs.snapshot()).toHaveLength(1)
  })

  it('サーバが対応していなければ 1 件も積まない', async () => {
    const f = await buildFixture({ upscaler: stubUpscaler(false) })

    const res = await f.send(f.shots.map((shot) => shot.id), false)

    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toBe(UPSCALE_UNSUPPORTED_MESSAGE)
    expect(f.upscaleJobs.snapshot()).toEqual([])
  })
})
