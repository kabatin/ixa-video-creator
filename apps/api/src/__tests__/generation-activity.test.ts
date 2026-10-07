import { OpenAPIHono } from '@hono/zod-openapi'
import {
  GenerationJobId,
  ModelId,
  ShotId,
  newId,
  type GenerationJob,
  type ProjectId,
  type Shot,
} from '@ixa/domain'
import { aShot, createInMemoryShotRepository } from '@ixa/generation/testing'
import { createProviderRegistry } from '@ixa/provider-core'
import { vpipeH3TurboDraftModel } from '@ixa/provider-video'
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
/** 尺 1 秒あたりの時間を持たないモデル（一律の目安）。 */
const FLAT = testModel({
  id: 'test/flat-model',
  typicalLatencySec: 210,
})

const aJob = (patch: Partial<GenerationJob> = {}): GenerationJob => ({
  id: newId(GenerationJobId),
  shotId: newId(ShotId),
  specHash: 'a'.repeat(64),
  requestedModel: 'AUTO',
  resolvedModel: ModelId.parse('test/flat-model'),
  routerDecision: null,
  status: 'running',
  attempt: 1,
  providerJobRef: null,
  error: null,
  parentTakeId: null,
  regenerationReason: null,
  corrections: [],
    seed: null,
  queuedAt: new Date('2026-09-30T10:00:00Z'),
  startedAt: new Date('2026-09-30T10:00:05Z'),
  providerStartedAt: new Date('2026-09-30T10:00:10Z'),
  finishedAt: null,
  ...patch,
})

const build = (jobs: readonly GenerationJob[], shots: readonly Shot[] = []) => {
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
      shots: createInMemoryShotRepository(shots),
      registry: createProviderRegistry([createTestVideoProvider([FLAT, vpipeH3TurboDraftModel])]),
    }),
  )
  return { app, asked }
}

type Body = {
  data: {
    shotId: string
    status: string
    modelLabel: string | null
    estimatedLatencySec: number | null
    queuedAt: string
    startedAt: string | null
    providerStartedAt: string | null
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
        modelId: 'test/flat-model',
        modelLabel: 'test/flat-model',
        estimatedLatencySec: 210,
        queuedAt: '2026-09-30T10:00:00.000Z',
        startedAt: '2026-09-30T10:00:05.000Z',
        providerStartedAt: '2026-09-30T10:00:10.000Z',
        attempt: 1,
      },
    ])
  })

  /**
   * 送ったがまだ作り始めていない（生成先の中で順番待ち）。vpipe は 1 本ずつ作るので、送った 2 本目はこうなる
   * （制作者 2026-10-04「カット２，３が作成中になってる」）。作り始めた時刻を null で返し、画面が「順番待ち」と出せるようにする。
   */
  it('生成先がまだ作り始めていなければ、作り始めた時刻を null で返す', async () => {
    const { app } = build([aJob({ providerStartedAt: null })])

    const body = (await (await app.request(`/projects/${project.id}/generations/active`)).json()) as Body

    expect(body.data[0]?.providerStartedAt).toBeNull()
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
      body.data.map((entry) => [entry.status, entry.modelLabel, entry.estimatedLatencySec]),
    ).toEqual([
      ['queued', null, null],
      ['running', null, null],
    ])
  })

  /**
   * 目安は作る尺から（制作者 2026-10-02「5秒ぐらいの動画で7分だからそれから計算する必要がありそう」）。
   * 一律 7 分だったので、10.13 秒の CUT-01（実測 911 秒）も「約 7 分」と出ていた。
   */
  it('尺 1 秒あたりの時間を持つモデルは、Shot の尺（生成する尺へ寄せた後）から目安を出す', async () => {
    const long = aShot(project.id, { durationSec: 10.13 })
    const short = aShot(project.id, { durationSec: 6.3 })
    const model = ModelId.parse(vpipeH3TurboDraftModel.id)
    const { app } = build(
      [aJob({ shotId: long.id, resolvedModel: model }), aJob({ shotId: short.id, resolvedModel: model })],
      [long, short],
    )

    const body = (await (
      await app.request(`/projects/${project.id}/generations/active`)
    ).json()) as Body

    const [longEstimate, shortEstimate] = body.data.map((entry) => entry.estimatedLatencySec ?? 0)
    // 10.13 秒は最長 10.125 秒で作る（1.5 倍まで伸ばす）。実測 911 秒。
    expect(longEstimate).toBeGreaterThan(840)
    expect(longEstimate).toBeLessThan(960)
    // 6.3 秒は 6.583 秒へ切り上げて作る。実測 549 秒。
    expect(shortEstimate).toBeGreaterThan(520)
    expect(shortEstimate).toBeLessThan(620)
  })

  it('Shot が見つからない・尺が作れないときは、モデルの一律の目安に戻す（落ちない）', async () => {
    const tooLong = aShot(project.id, { durationSec: 30 })
    const model = ModelId.parse(vpipeH3TurboDraftModel.id)
    const { app } = build(
      [aJob({ shotId: tooLong.id, resolvedModel: model }), aJob({ resolvedModel: model })],
      [tooLong],
    )

    const response = await app.request(`/projects/${project.id}/generations/active`)
    const body = (await response.json()) as Body

    expect(response.status).toBe(200)
    expect(body.data.map((entry) => entry.estimatedLatencySec)).toEqual([
      vpipeH3TurboDraftModel.economics.typicalLatencySec,
      vpipeH3TurboDraftModel.economics.typicalLatencySec,
    ])
  })

  it('無いプロジェクトは 404', async () => {
    const { app } = build([])

    expect((await app.request(`/projects/${aProject().id}/generations/active`)).status).toBe(404)
  })
})
