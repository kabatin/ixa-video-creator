import { OpenAPIHono } from '@hono/zod-openapi'
import { CharacterId, ModelId, ProviderId, newId, type ImageGenerationJob, type ProjectEvent } from '@ixa/domain'
import { aShot, createInMemoryImageJobRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { imageJobCancelRoutes } from '../routes/image-job-cancel.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 絵を作るのを止める口（制作者 2026-10-04「いま30個ぐらいキューに入ってる画像生成とめたい」「API追加して、画像生成も
 * 停められるようにしよう」）。止めるのは待っている・作っている絵だけ。**止めたことは行を書き換えた時点で確定する**
 * （作っている絵は worker が次に見たときに手を引き、届いた絵で最初のフレームを差し替えない）。
 */

type Ok<T> = { success: true; data: T }

const project = aProject()
const other = aProject()
const shotA = aShot(project.id, { order: 1000, code: 'shot_001' })
const shotB = aShot(project.id, { order: 2000, code: 'shot_002' })
const foreign = aShot(other.id, { order: 1000, code: 'shot_001' })
const CODEX = { providerId: ProviderId.parse('codex-cli'), modelId: ModelId.parse('codex-cli/image-gen') }

const build = async () => {
  const imageJobs = createInMemoryImageJobRepository()
  const published: ProjectEvent[] = []
  const startFrame = (shot: typeof shotA): Promise<ImageGenerationJob> =>
    imageJobs.create({ kind: 'start_frame', projectId: shot.projectId, shotId: shot.id, ...CODEX })
  const jobs = {
    a: await startFrame(shotA),
    b: await startFrame(shotB),
    foreign: await startFrame(foreign),
    sheet: await imageJobs.create({
      kind: 'character_sheet',
      projectId: project.id,
      characterId: newId(CharacterId),
      referenceAssetIds: [],
      ...CODEX,
    }),
  }
  // 作っている途中のもの（worker が拾った後）も止める。
  await imageJobs.markRunning(jobs.b.id, [])
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    imageJobCancelRoutes({
      projects: createInMemoryProjectRepository([project, other]),
      imageJobs,
      events: { publish: (event: ProjectEvent) => Promise.resolve(void published.push(event)) },
      logger: createLogger('silent'),
    }),
  )
  const post = (path: string, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  const statusOf = async (job: ImageGenerationJob) => (await imageJobs.findById(job.id))?.status
  return { imageJobs, jobs, published, post, statusOf }
}

describe('POST /projects/:projectId/images/cancel', () => {
  it('Shot を指定しなければ、その作品で待っている・作っている絵をすべて止める（ほかの作品は触らない）', async () => {
    const f = await build()

    const res = await f.post(`/projects/${project.id}/images/cancel`)

    expect(res.status).toBe(200)
    const { cancelledJobIds } = ((await res.json()) as Ok<{ cancelledJobIds: string[] }>).data
    expect([...cancelledJobIds].sort()).toEqual([f.jobs.a.id, f.jobs.b.id, f.jobs.sheet.id].sort())
    expect(await f.statusOf(f.jobs.a)).toBe('cancelled')
    expect(await f.statusOf(f.jobs.b)).toBe('cancelled')
    expect(await f.statusOf(f.jobs.foreign)).toBe('queued')
  })

  it('Shot を指定すれば、その Shot の絵だけ止める', async () => {
    const f = await build()

    await f.post(`/projects/${project.id}/images/cancel`, { shotIds: [shotA.id] })

    expect(await f.statusOf(f.jobs.a)).toBe('cancelled')
    expect(await f.statusOf(f.jobs.b)).toBe('running')
    expect(await f.statusOf(f.jobs.sheet)).toBe('queued')
  })

  it('止めたことを画面へ知らせる（「作っています」の印を読み込み直さずに消すため）', async () => {
    const f = await build()

    await f.post(`/projects/${project.id}/images/cancel`, { shotIds: [shotA.id] })

    expect(f.published).toEqual([
      expect.objectContaining({ type: 'image_job.status', jobId: f.jobs.a.id, shotId: shotA.id, status: 'cancelled', error: null }),
    ])
  })

  it('終わった絵は止めない（何も無ければ空を返す）', async () => {
    const f = await build()
    await f.post(`/projects/${project.id}/images/cancel`)

    const again = await f.post(`/projects/${project.id}/images/cancel`)

    expect(((await again.json()) as Ok<{ cancelledJobIds: string[] }>).data.cancelledJobIds).toEqual([])
  })

  it('無い作品は 404。Shot の指定の形が違えば 422', async () => {
    const f = await build()

    expect((await f.post(`/projects/${aProject().id}/images/cancel`)).status).toBe(404)
    expect((await f.post(`/projects/${project.id}/images/cancel`, { shotIds: ['not-an-id'] })).status).toBe(422)
  })
})
