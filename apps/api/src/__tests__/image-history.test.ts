import { OpenAPIHono } from '@hono/zod-openapi'
import { ModelId, ProviderId, newId, MediaAssetId as MediaAssetIdSchema, type ImageGenerationJobId, type MediaAssetId } from '@ixa/domain'
import { replaceManualStartFrame } from '@ixa/generation'
import {
  aShot,
  createInMemoryCharacterRepository,
  createInMemoryImageCheckRepository,
  createInMemoryImageJobRepository,
  createInMemoryShotReferenceRepository,
  createInMemoryShotRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { imageHistoryRoutes, type ImageHistoryEntry } from '../routes/image-history.js'
import { aProject } from './fixtures.js'

/**
 * 作った絵の履歴と、人が押すやり直し（ADR-0055）。
 */

type Ok<T> = { success: true; data: T }

const codex = { providerId: ProviderId.parse('codex-cli'), modelId: ModelId.parse('codex-cli/image-gen') }

const build = () => {
  const project = aProject()
  const shot = aShot(project.id)
  const imageJobs = createInMemoryImageJobRepository()
  const imageChecks = createInMemoryImageCheckRepository()
  const shotReferences = createInMemoryShotReferenceRepository()
  const characters = createInMemoryCharacterRepository()
  const enqueued: ImageGenerationJobId[] = []
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    imageHistoryRoutes({
      shots: createInMemoryShotRepository([shot]),
      characters,
      shotReferences,
      imageJobs,
      imageChecks,
      imageQueue: { enqueue: (id) => Promise.resolve(void enqueued.push(id)) },
      maxRetries: 2,
      events: { publish: () => Promise.resolve() },
      logger: createLogger('silent'),
    }),
  )
  /** 描き終えた開始フレームのジョブを 1 つ足す（つながりも作れる）。 */
  const drawn = async (retryOf?: { jobId: ImageGenerationJobId; attempt: number }, sentPrompt: string | null = null) => {
    const job = await imageJobs.create({ kind: 'start_frame', projectId: project.id, shotId: shot.id, ...codex, ...(retryOf === undefined ? {} : { retryOf }) })
    const mediaAssetId: MediaAssetId = newId(MediaAssetIdSchema)
    await imageJobs.markChecking(job.id, mediaAssetId, {}, sentPrompt)
    return imageJobs.finishChecking(job.id)
  }
  return { app, project, shot, imageJobs, imageChecks, shotReferences, characters, enqueued, drawn }
}

describe('GET /shots/{id}/start-frame/history', () => {
  it('作った絵を新しい順に、チェックの結果・当てたか・いま付いているかと返す', async () => {
    const f = build()
    const first = await drawnWithRetry(f)
    const second = await f.drawn({ jobId: first.id, attempt: 2 })
    await f.imageJobs.markApplied(second.id)
    await replaceManualStartFrame(f.shotReferences, f.shot.id, first.mediaAssetId ?? newId(MediaAssetIdSchema))

    const res = await f.app.request(`/shots/${f.shot.id}/start-frame/history`)
    expect(res.status).toBe(200)
    const { items, maxRetries } = ((await res.json()) as Ok<{ items: ImageHistoryEntry[]; maxRetries: number }>).data
    expect(maxRetries).toBe(2)
    expect(items.map((item) => [item.attempt, item.applied, item.current])).toEqual([
      [2, true, false],
      [1, false, true],
    ])
    expect(items[1]?.check).toMatchObject({ mark: 'retry', issues: [{ kind: 'anatomy', message: '指が 6 本' }] })
    expect(items[0]?.check).toBeNull()
    expect(items[0]?.retryOfJobId).toBe(first.id)
  })

  it('各絵に、送った指示の本文と使った AI を添える。記録する前の絵は null（プロンプトビューア）', async () => {
    const f = build()
    const old = await f.drawn()
    await f.drawn({ jobId: old.id, attempt: 2 }, '暗いガレージ。作業台にヘルメット')

    const res = await f.app.request(`/shots/${f.shot.id}/start-frame/history`)
    const { items } = ((await res.json()) as Ok<{ items: ImageHistoryEntry[] }>).data
    expect(items.map((item) => item.sentPrompt)).toEqual(['暗いガレージ。作業台にヘルメット', null])
    expect(items[0]?.modelId).toBe('codex-cli/image-gen')
  })

  it('無い Shot は 404', async () => {
    const f = build()
    expect((await f.app.request(`/shots/${newId(MediaAssetIdSchema)}/start-frame/history`)).status).toBe(404)
  })
})

/** 1 枚目を描き、「やり直す」のチェックを付けて返す。 */
const drawnWithRetry = async (f: ReturnType<typeof build>) => {
  const first = await f.drawn()
  await f.imageChecks.create({
    imageJobId: first.id,
    outcome: 'checked',
    verdict: 'retry',
    score: 0.2,
    issues: [{ kind: 'anatomy', message: '指が 6 本' }],
    promptDelta: 'five fingers',
    note: null,
    costUsd: 0.01,
  })
  return first
}

describe('POST /image-jobs/{id}/retry', () => {
  it('同じ AI で、つながりに足して積む', async () => {
    const f = build()
    const first = await drawnWithRetry(f)

    const res = await f.app.request(`/image-jobs/${first.id}/retry`, { method: 'POST' })
    expect(res.status).toBe(202)
    const { jobId } = ((await res.json()) as Ok<{ jobId: ImageGenerationJobId }>).data
    expect(f.enqueued).toEqual([jobId])
    expect(await f.imageJobs.findById(jobId)).toMatchObject({
      kind: 'start_frame',
      shotId: f.shot.id,
      retryOfJobId: first.id,
      attempt: 2,
      providerId: codex.providerId,
      status: 'queued',
    })
  })

  /** レビューの指摘（2026-10-19）。キーアートは持ち主の Shot が無いので、同じ絵のやり直しの連打を別に止める。 */
  it('キーアートでも、同じ絵のやり直しが動いていれば 409（連打で重ねない）', async () => {
    const f = build()
    const art = await f.imageJobs.create({ kind: 'key_art', projectId: f.project.id, instruction: null, ...codex })
    await f.imageJobs.markChecking(art.id, newId(MediaAssetIdSchema), {}, null)
    await f.imageJobs.finishChecking(art.id)

    expect((await f.app.request(`/image-jobs/${art.id}/retry`, { method: 'POST' })).status).toBe(202)
    expect((await f.app.request(`/image-jobs/${art.id}/retry`, { method: 'POST' })).status).toBe(409)
    expect(f.enqueued).toHaveLength(1)
  })

  it('同じ絵のやり直しがもう済んでいれば 409（新しい方の絵からやり直す）', async () => {
    const f = build()
    const first = await drawnWithRetry(f)
    const res = await f.app.request(`/image-jobs/${first.id}/retry`, { method: 'POST' })
    const { jobId } = ((await res.json()) as Ok<{ jobId: ImageGenerationJobId }>).data
    await f.imageJobs.markChecking(jobId, newId(MediaAssetIdSchema), {}, null)
    await f.imageJobs.finishChecking(jobId)

    const again = await f.app.request(`/image-jobs/${first.id}/retry`, { method: 'POST' })
    expect(again.status).toBe(409)
    expect(f.enqueued).toHaveLength(1)
  })

  it('同じ Shot で作っている最中なら 409', async () => {
    const f = build()
    const first = await drawnWithRetry(f)
    await f.imageJobs.create({ kind: 'start_frame', projectId: f.project.id, shotId: f.shot.id, ...codex })
    expect((await f.app.request(`/image-jobs/${first.id}/retry`, { method: 'POST' })).status).toBe(409)
  })

  it('まだ絵ができていなければ 422、無ければ 404', async () => {
    const f = build()
    const queued = await f.imageJobs.create({ kind: 'start_frame', projectId: f.project.id, shotId: f.shot.id, ...codex })
    expect((await f.app.request(`/image-jobs/${queued.id}/retry`, { method: 'POST' })).status).toBe(422)
    expect((await f.app.request(`/image-jobs/${newId(MediaAssetIdSchema)}/retry`, { method: 'POST' })).status).toBe(404)
  })
})

describe('GET /characters/{id}/identity-images/checks', () => {
  it('キャラクターシートとして作った識別画像にだけ、チェックの結果を返す', async () => {
    const f = build()
    const character = await f.characters.create({ workspaceId: f.project.workspaceId, projectId: f.project.id, name: 'a', displayName: 'A' })
    const job = await f.imageJobs.create({ kind: 'character_sheet', projectId: f.project.id, characterId: character.id, referenceAssetIds: [], ...codex })
    const sheet: MediaAssetId = newId(MediaAssetIdSchema)
    await f.imageJobs.markChecking(job.id, sheet, {}, null)
    await f.imageChecks.create({ imageJobId: job.id, outcome: 'skipped', verdict: null, score: null, issues: [], promptDelta: null, note: '見ていません', costUsd: 0 })
    const uploaded: MediaAssetId = newId(MediaAssetIdSchema)
    await f.characters.addIdentityImage({ characterId: character.id, mediaAssetId: uploaded, role: 'face_front', isPrimary: true, order: 0 })
    await f.characters.addIdentityImage({ characterId: character.id, mediaAssetId: sheet, role: 'four_view', isPrimary: true, order: 1 })

    const res = await f.app.request(`/characters/${character.id}/identity-images/checks`)
    expect(res.status).toBe(200)
    const items = ((await res.json()) as Ok<{ mediaAssetId: string; check: { mark: string } | null }[]>).data
    expect(items).toEqual([{ mediaAssetId: sheet, jobId: job.id, check: expect.objectContaining({ mark: 'unchecked', note: '見ていません' }) as unknown }])
  })
})
