import { OpenAPIHono } from '@hono/zod-openapi'
import { UPSCALE_REASON } from '@ixa/domain'
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
import { takeUpscaleRoutes, UPSCALE_UNSUPPORTED_MESSAGE } from '../routes/take-upscale.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 解像度を上げる口（ADR-0044）。
 *
 * **押しても必ず断られる操作を、押せる形で出さない**ための判定がここを通る。
 * 判定の規則そのものは domain（`upscaleBlocker`）にあり、ここでは「呼んでいること」を見る。
 */

const stubUpscaler = (available = true): VideoUpscaler => ({
  providerId: 'vpipe' as VideoUpscaler['providerId'],
  modelId: 'vpipe/flashvsr-upscale' as VideoUpscaler['modelId'],
  available: () => Promise.resolve(available),
  submit: () => Promise.reject(new Error('API からは投入しない')),
  poll: () => Promise.reject(new Error('API からは問い合わせない')),
  cancel: () => Promise.resolve(),
})

const buildFixture = async (options: {
  readonly upscaler?: VideoUpscaler | null
  readonly enqueue?: () => Promise<void>
  readonly sourceOverrides?: Parameters<typeof aTake>[2]
} = {}) => {
  const project = aProject()
  const shot = aShot(project.id)
  /** **同じ作品の別の Shot。** 「その Shot の Take か」の検査を、実在する Shot で試すために要る。 */
  const otherShot = aShot(project.id, { code: 'OTHER', order: 9000 })
  const shots = createInMemoryShotRepository([shot, otherShot])
  const takes = createInMemoryTakeRepository()
  const source = await takes.create(aTake(shot, 'a'.repeat(64), options.sourceOverrides))
  const upscaleJobs = createInMemoryUpscaleJobRepository()
  const enqueued: string[] = []

  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    takeUpscaleRoutes({
      shots,
      takes,
      projects: createInMemoryProjectRepository([project]),
      upscaleJobs,
      upscaleQueue: {
        enqueue: options.enqueue
          ? options.enqueue
          : (id) => {
              enqueued.push(id)
              return Promise.resolve()
            },
      },
      upscaler: options.upscaler === undefined ? stubUpscaler() : options.upscaler,
      events: createInMemoryProjectEvents(),
      logger: createLogger('silent'),
    }),
  )

  return { app, project, shot, otherShot, source, takes, upscaleJobs, enqueued: () => enqueued }
}

const post = (app: OpenAPIHono, path: string) => app.request(path, { method: 'POST' })

describe('POST /shots/:shotId/takes/:takeId/upscale', () => {
  it('順番に入れて 202 を返す', async () => {
    const f = await buildFixture()

    const res = await post(f.app, `/shots/${f.shot.id}/takes/${f.source.id}/upscale`)

    expect(res.status).toBe(202)
    const [job] = f.upscaleJobs.snapshot()
    expect(job).toMatchObject({ sourceTakeId: f.source.id, status: 'queued' })
    expect(f.enqueued()).toEqual([job?.id])
  })

  /** 対応していない版へ投げると、大きな本文を送ってから断られる。押す前に止める。 */
  it('サーバが対応していなければ断る', async () => {
    const f = await buildFixture({ upscaler: stubUpscaler(false) })

    const res = await post(f.app, `/shots/${f.shot.id}/takes/${f.source.id}/upscale`)

    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toBe(UPSCALE_UNSUPPORTED_MESSAGE)
    expect(f.upscaleJobs.snapshot()).toEqual([])
  })

  it('この機械に口が無ければ断る', async () => {
    const f = await buildFixture({ upscaler: null })

    expect((await post(f.app, `/shots/${f.shot.id}/takes/${f.source.id}/upscale`)).status).toBe(422)
    expect(f.upscaleJobs.snapshot()).toEqual([])
  })

  /** 別の Shot の Take を上げると、出来たものが別の Shot にぶら下がる。 */
  it('その Shot の Take でなければ 404', async () => {
    const f = await buildFixture()

    // **実在する別の Shot** で試す（存在しない Shot だと、別の検査で 404 になってしまう）
    const res = await post(f.app, `/shots/${f.otherShot.id}/takes/${f.source.id}/upscale`)

    expect(res.status).toBe(404)
    expect(f.upscaleJobs.snapshot()).toEqual([])
  })

  /** 規則は domain に 1 つ。ここでは「呼んでいること」を見る。 */
  it('すでに上げた Take は断る', async () => {
    const f = await buildFixture({ sourceOverrides: { regenerationReason: UPSCALE_REASON } })

    const res = await post(f.app, `/shots/${f.shot.id}/takes/${f.source.id}/upscale`)

    expect(res.status).toBe(422)
    expect(f.upscaleJobs.snapshot()).toEqual([])
  })

  it('上げている最中なら、二重に積まない', async () => {
    const f = await buildFixture()
    await post(f.app, `/shots/${f.shot.id}/takes/${f.source.id}/upscale`)

    const again = await post(f.app, `/shots/${f.shot.id}/takes/${f.source.id}/upscale`)

    expect(again.status).toBe(422)
    expect(f.upscaleJobs.snapshot()).toHaveLength(1)
  })

  /**
   * **入れ損ねたら失敗にしてから投げる。** 待っているまま残すと、その Take は
   * 「上げています」のまま二度と頼めなくなる。
   */
  it('順番に入れられなければ、ジョブを失敗にする', async () => {
    const f = await buildFixture({ enqueue: () => Promise.reject(new Error('キューが落ちている')) })

    const res = await post(f.app, `/shots/${f.shot.id}/takes/${f.source.id}/upscale`)

    expect(res.status).toBe(500)
    expect(f.upscaleJobs.snapshot()[0]?.status).toBe('failed')
  })
})

describe('POST /projects/:projectId/upscales/cancel', () => {
  it('待っている仕事を止める', async () => {
    const f = await buildFixture()
    await post(f.app, `/shots/${f.shot.id}/takes/${f.source.id}/upscale`)

    const res = await post(f.app, `/projects/${f.project.id}/upscales/cancel`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { cancelledJobIds: readonly string[] } }
    expect(body.data.cancelledJobIds).toHaveLength(1)
    expect(f.upscaleJobs.snapshot()[0]?.status).toBe('cancelled')
  })

  it('無い Project は 404', async () => {
    const f = await buildFixture()
    expect((await post(f.app, `/projects/${aProject().id}/upscales/cancel`)).status).toBe(404)
  })
})
