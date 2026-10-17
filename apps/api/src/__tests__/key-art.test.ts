import { OpenAPIHono } from '@hono/zod-openapi'
import { ModelId, ProjectId as ProjectIdSchema, ProviderId, ShotId as ShotIdSchema, newId, type ImageGenerationJobId, type ProjectEvent } from '@ixa/domain'
import { createInMemoryImageJobRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers } from '../errors.js'
import { createLogger } from '../logger.js'
import { keyArtRoutes, type KeyArtJobResponse } from '../routes/key-art.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * サムネイルの背景を AI に描かせる口（キーアート。ADR-0051）。ジョブを枚数ぶん作って積むだけ。
 * 枚数と指示の上限は、破る値で 422 になることまで確かめる。
 */

type Ok<T> = { success: true; data: T }

const build = () => {
  const project = aProject()
  const imageJobs = createInMemoryImageJobRepository()
  const enqueued: ImageGenerationJobId[] = []
  const events: ProjectEvent[] = []
  const app = new OpenAPIHono()
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    keyArtRoutes({
      projects: createInMemoryProjectRepository([project]),
      imageJobs,
      imageQueue: { enqueue: (id) => Promise.resolve(void enqueued.push(id)) },
      imageModel: () => Promise.resolve({ providerId: ProviderId.parse('codex-cli'), modelId: ModelId.parse('codex-cli/image-gen') }),
      events: { publish: (event) => Promise.resolve(void events.push(event)) },
      logger: createLogger('silent'),
    }),
  )
  const generate = (body: unknown, projectId: string = project.id) =>
    app.request(`/projects/${projectId}/key-art/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { app, project, imageJobs, enqueued, events, generate }
}

describe('POST /projects/{projectId}/key-art/generate', () => {
  it('枚数ぶんキーアートのジョブを作って積み、出来事を流す', async () => {
    const f = build()

    const res = await f.generate({ count: 3, instruction: '  夕焼けの屋上  ' })

    expect(res.status).toBe(202)
    const { jobIds } = ((await res.json()) as Ok<{ jobIds: string[] }>).data
    expect(jobIds).toHaveLength(3)
    expect(f.enqueued).toEqual(jobIds)
    expect(f.imageJobs.snapshot().map((job) => [job.kind, job.shotId, job.characterId, job.instruction])).toEqual(
      Array.from({ length: 3 }, () => ['key_art', null, null, '夕焼けの屋上']),
    )
    expect(f.events.map((event) => event.type)).toEqual(['image_job.status', 'image_job.status', 'image_job.status'])
  })

  it('枚数を省けば 1 枚。空の指示は「指示なし」', async () => {
    const f = build()
    expect((await f.generate({ instruction: '   ' })).status).toBe(202)
    expect(f.imageJobs.snapshot().map((job) => job.instruction)).toEqual([null])
  })

  it('枚数は 1〜4。0 と 5 は 422 で、何も作らない', async () => {
    const f = build()
    expect((await f.generate({ count: 0 })).status).toBe(422)
    expect((await f.generate({ count: 5 })).status).toBe(422)
    expect((await f.generate({ count: 1.5 })).status).toBe(422)
    expect((await f.generate({ count: 4 })).status).toBe(202)
    expect(f.imageJobs.snapshot()).toHaveLength(4)
  })

  it('指示は 500 字まで。501 字は 422', async () => {
    const f = build()
    expect((await f.generate({ instruction: 'あ'.repeat(501) })).status).toBe(422)
    expect((await f.generate({ instruction: 'あ'.repeat(500) })).status).toBe(202)
    expect(f.imageJobs.snapshot()).toHaveLength(1)
  })

  it('無いプロジェクトは 404', async () => {
    const f = build()
    expect((await f.generate({}, newId(ProjectIdSchema))).status).toBe(404)
    expect(f.imageJobs.snapshot()).toEqual([])
  })
})

describe('GET /projects/{projectId}/key-art', () => {
  it('キーアートのジョブだけを新しい順で返す（状態・指示・できた絵・理由）', async () => {
    const f = build()
    await f.generate({ count: 2 })
    await f.imageJobs.create({
      kind: 'start_frame',
      projectId: f.project.id,
      shotId: newId(ShotIdSchema),
      providerId: ProviderId.parse('codex-cli'),
      modelId: ModelId.parse('codex-cli/image-gen'),
    })
    const [first, second] = [...f.imageJobs.snapshot()].filter((job) => job.kind === 'key_art').sort((a, b) => a.id.localeCompare(b.id))

    const res = await f.app.request(`/projects/${f.project.id}/key-art`)

    expect(res.status).toBe(200)
    const list = ((await res.json()) as Ok<KeyArtJobResponse[]>).data
    expect(list.map((job) => job.id)).toEqual([second?.id, first?.id])
    expect(list[0]).toMatchObject({ status: 'queued', instruction: null, mediaAssetId: null, error: null, finishedAt: null })
    expect(typeof list[0]?.queuedAt).toBe('string')
  })

  it('無いプロジェクトは 404', async () => {
    const f = build()
    expect((await f.app.request(`/projects/${newId(ProjectIdSchema)}/key-art`)).status).toBe(404)
  })
})
