import { OpenAPIHono } from '@hono/zod-openapi'
import {
  MediaAssetId as MediaAssetIdSchema,
  ModelId,
  ProviderId,
  newId,
  type ImageGenerationJobId,
  type ProjectEvent,
  type Shot,
} from '@ixa/domain'
import { replaceManualStartFrame } from '@ixa/generation'
import {
  aShot,
  createInMemoryImageJobRepository,
  createInMemoryShotReferenceRepository,
  createInMemoryShotRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { shotStartFrameGenerateRoutes } from '../routes/shot-start-frame-generate.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 絵コンテの画像を作る口（ADR-0029）。ジョブを 1 行作って image キューへ入れるだけ。作るのは worker。
 */

type Ok<T> = { success: true; data: T }
type Err = { success: false; error: string; fields?: Record<string, string[]> }

const project = aProject()
const other = aProject()
const shotA = aShot(project.id, { order: 1000, code: 'shot_001' })
const shotB = aShot(project.id, { order: 2000, code: 'shot_002' })
const foreign = aShot(other.id, { order: 1000, code: 'shot_001' })

const CODEX = { providerId: ProviderId.parse('codex-cli'), modelId: ModelId.parse('codex-cli/image-gen') }

const build = (
  options: {
    failEnqueue?: boolean
    shots?: readonly Shot[]
    /** いま選んでいる画像の AI（ADR-0032）。作るたびに呼ばれる。 */
    imageModel?: () => { providerId: ProviderId; modelId: ModelId }
  } = {},
) => {
  const enqueued: ImageGenerationJobId[] = []
  const published: ProjectEvent[] = []
  const deps = {
    shots: createInMemoryShotRepository([...(options.shots ?? [shotA, shotB, foreign])]),
    projects: createInMemoryProjectRepository([project, other]),
    shotReferences: createInMemoryShotReferenceRepository(),
    imageJobs: createInMemoryImageJobRepository(),
    imageQueue: {
      enqueue: (id: ImageGenerationJobId) =>
        options.failEnqueue === true ? Promise.reject(new Error('Redis に繋がりません')) : Promise.resolve(void enqueued.push(id)),
    },
    imageModel: () => Promise.resolve(options.imageModel?.() ?? CODEX),
    events: { publish: (event: ProjectEvent) => Promise.resolve(void published.push(event)) },
    logger: createLogger('silent'),
  }
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route('/', shotStartFrameGenerateRoutes(deps))
  const post = (path: string, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  return { ...deps, enqueued, published, post }
}

describe('POST /shots/:id/start-frame/generate', () => {
  it('ジョブを 1 行作って image キューへ入れ、待っていることを知らせる', async () => {
    const f = build()

    const res = await f.post(`/shots/${shotA.id}/start-frame/generate`)

    expect(res.status).toBe(202)
    const { jobId } = ((await res.json()) as Ok<{ jobId: ImageGenerationJobId }>).data
    expect(await f.imageJobs.findById(jobId)).toMatchObject({
      status: 'queued',
      shotId: shotA.id,
      projectId: project.id,
      providerId: 'codex-cli',
      modelId: 'codex-cli/image-gen',
    })
    expect(f.enqueued).toEqual([jobId])
    expect(f.published).toMatchObject([{ type: 'image_job.status', shotId: shotA.id, jobId, status: 'queued' }])
  })

  /** 使う AI は画面で選び直せる（ADR-0032）。起動し直さなくても、次の 1 枚から効く。 */
  it('作るたびに、いま選んでいる AI をジョブに記す', async () => {
    const stub = { providerId: ProviderId.parse('stub-image'), modelId: ModelId.parse('stub/gemini-like-image') }
    const current = { model: CODEX }
    const f = build({ imageModel: () => current.model })

    const first = ((await (await f.post(`/shots/${shotA.id}/start-frame/generate`)).json()) as Ok<{ jobId: ImageGenerationJobId }>).data
    current.model = stub
    const second = ((await (await f.post(`/shots/${shotB.id}/start-frame/generate`)).json()) as Ok<{ jobId: ImageGenerationJobId }>).data

    expect(await f.imageJobs.findById(first.jobId)).toMatchObject({ providerId: 'codex-cli' })
    expect(await f.imageJobs.findById(second.jobId)).toMatchObject({ providerId: 'stub-image' })
  })

  it('同じ Shot で作っている間は重ねない（409）', async () => {
    const f = build()
    await f.post(`/shots/${shotA.id}/start-frame/generate`)

    const res = await f.post(`/shots/${shotA.id}/start-frame/generate`)

    expect(res.status).toBe(409)
    expect(f.enqueued).toHaveLength(1)
  })

  /** キューに入れ損ねた行を「待っている」のまま残すと、その Shot は二度と作れなくなる（409 のまま）。 */
  it('キューに入れられなければ、ジョブを失敗にしてから返す', async () => {
    const f = build({ failEnqueue: true })

    const res = await f.post(`/shots/${shotA.id}/start-frame/generate`)

    expect(res.status).toBe(500)
    expect(await f.imageJobs.findActiveByShot(shotA.id)).toBeNull()
    expect((await f.imageJobs.findLatestByShot(shotA.id))?.status).toBe('failed')
  })

  it('無い Shot は 404', async () => {
    const res = await build().post(`/shots/${newId(MediaAssetIdSchema)}/start-frame/generate`)

    expect(res.status).toBe(404)
  })
})

describe('POST /projects/:projectId/start-frames/generate', () => {
  it('まとめて頼む。作っている Shot と、絵がもうある Shot（既定）は飛ばして数を返す', async () => {
    const shotC = aShot(project.id, { order: 3000, code: 'shot_003' })
    const f = build({ shots: [shotA, shotB, shotC] })
    await f.post(`/shots/${shotA.id}/start-frame/generate`)
    await replaceManualStartFrame(f.shotReferences, shotB.id, newId(MediaAssetIdSchema))

    const res = await f.post(`/projects/${project.id}/start-frames/generate`, { shotIds: [shotA.id, shotB.id, shotC.id] })

    expect(res.status).toBe(202)
    const data = ((await res.json()) as Ok<{ jobIds: string[]; skipped: { drawing: number; hasFrame: number } }>).data
    expect(data.jobIds).toHaveLength(1)
    expect(data.skipped).toEqual({ drawing: 1, hasFrame: 1 })
    expect((await f.imageJobs.findActiveByShot(shotC.id))?.id).toBe(data.jobIds[0])
  })

  it('絵がある Shot も作り直せる（onlyMissing: false）', async () => {
    const f = build({ shots: [shotA] })
    await replaceManualStartFrame(f.shotReferences, shotA.id, newId(MediaAssetIdSchema))

    const res = await f.post(`/projects/${project.id}/start-frames/generate`, { shotIds: [shotA.id], onlyMissing: false })

    expect(((await res.json()) as Ok<{ jobIds: string[] }>).data.jobIds).toHaveLength(1)
  })

  it('別の Project の Shot が混じれば、何もせず 422', async () => {
    const f = build()

    const res = await f.post(`/projects/${project.id}/start-frames/generate`, { shotIds: [shotA.id, foreign.id] })

    expect(res.status).toBe(422)
    expect(((await res.json()) as Err).fields?.shotIds).toBeDefined()
    expect(f.enqueued).toEqual([])
  })

  it('一度に頼めるのは 100 件まで', async () => {
    const f = build()
    const many = Array.from({ length: 101 }, () => shotA.id)

    const res = await f.post(`/projects/${project.id}/start-frames/generate`, { shotIds: many })

    expect(res.status).toBe(422)
  })

  it('無い Project は 404', async () => {
    const res = await build().post(`/projects/${newId(MediaAssetIdSchema)}/start-frames/generate`, { shotIds: [shotA.id] })

    expect(res.status).toBe(404)
  })
})
