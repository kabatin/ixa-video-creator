import { OpenAPIHono } from '@hono/zod-openapi'
import type { MediaAsset, Project, Shot } from '@ixa/domain'
import {
  aShot,
  createInMemoryMediaAssetRepository,
  createInMemoryShotReferenceRepository,
  createInMemoryShotRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { shotEndFrameRoutes } from '../routes/shot-end-frame.js'
import { aProject } from './fixtures.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryEditTransaction } from './in-memory-edit-transaction.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { aMediaAsset } from './in-memory-timeline-repositories.js'

/**
 * Shot の終わりの画像（2026-10-24）。手動の参照 `end_frame` 1 件で、付けると「Take を尺に合わせる」になる
 * （動画の AI は Shot の尺より少し長く作り、終わりの画像はファイルの最後に来るため）。
 */

type Ok<T> = { success: true; data: T }
type Err = { success: false; fields?: Record<string, string[]> }

const build = (project: Project, shot: Shot, assets: readonly MediaAsset[]) => {
  const deps = {
    shots: createInMemoryShotRepository([shot]),
    projects: createInMemoryProjectRepository([project]),
    mediaAssets: createInMemoryMediaAssetRepository([...assets]),
    shotReferences: createInMemoryShotReferenceRepository(),
  }
  const editBatches = createInMemoryEditBatchRepository()
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    shotEndFrameRoutes({
      ...deps,
      transaction: createInMemoryEditTransaction({ editBatches, shotReferences: deps.shotReferences, shots: deps.shots }),
    }),
  )
  const call = (method: string, body?: unknown) =>
    app.request(`/shots/${shot.id}/end-frame`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  return { ...deps, editBatches, call }
}

const setup = () => {
  const project = aProject()
  const shot = aShot(project.id)
  const image = aMediaAsset({ workspaceId: project.workspaceId, kind: 'image', mimeType: 'image/png' })
  return { project, shot, image }
}

describe('/shots/:id/end-frame', () => {
  it('付ける前は null', async () => {
    const { project, shot, image } = setup()
    const res = await build(project, shot, [image]).call('GET')
    expect(((await res.json()) as Ok<{ mediaAssetId: string | null }>).data.mediaAssetId).toBeNull()
  })

  it('付けると手動の end_frame 参照が 1 件になり、Shot は尺に合わせる再生になる', async () => {
    const { project, shot, image } = setup()
    const f = build(project, shot, [image])

    const res = await f.call('PUT', { mediaAssetId: image.id })

    expect(res.status).toBe(200)
    expect(((await res.json()) as Ok<unknown>).data).toEqual({ mediaAssetId: image.id, timing: 'fit' })
    const refs = await f.shotReferences.findByShot(shot.id)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ mediaAssetId: image.id, role: 'end_frame', sourceKind: 'manual' })
    expect((await f.shots.findById(shot.id))?.timing).toBe('fit')
  })

  it('取り消しの記録に、前の画像と前の再生の仕方を控える', async () => {
    const { project, shot, image } = setup()
    const f = build(project, shot, [image])

    await f.call('PUT', { mediaAssetId: image.id })

    const [batch] = f.editBatches.snapshot()
    expect(batch?.summary).toBe(`${shot.code} の終わりの画像を変える`)
    expect(batch?.entries).toEqual([{ shotId: shot.id, patch: { timing: 'trim' }, endFrame: null }])
  })

  it('最初のフレームには触らない', async () => {
    const { project, shot, image } = setup()
    const start = aMediaAsset({ workspaceId: project.workspaceId, kind: 'image', mimeType: 'image/png' })
    const f = build(project, shot, [image, start])
    await f.shotReferences.create({ shotId: shot.id, mediaAssetId: start.id, role: 'start_frame', weight: 1, order: 0, sourceKind: 'manual' })

    await f.call('PUT', { mediaAssetId: image.id })
    await f.call('DELETE')

    const refs = await f.shotReferences.findByShot(shot.id)
    expect(refs.map((ref) => [ref.role, ref.mediaAssetId])).toEqual([['start_frame', start.id]])
  })

  it('外すと無くなる（再生の仕方は戻さない）', async () => {
    const { project, shot, image } = setup()
    const f = build(project, shot, [image])
    await f.call('PUT', { mediaAssetId: image.id })

    const res = await f.call('DELETE')

    expect(res.status).toBe(204)
    expect(await f.shotReferences.findByShot(shot.id)).toEqual([])
    expect((await f.shots.findById(shot.id))?.timing).toBe('fit')
  })

  it('画像でない素材・別のワークスペースの素材は 422 で断る', async () => {
    const { project, shot } = setup()
    const video = aMediaAsset({ workspaceId: project.workspaceId, kind: 'video', mimeType: 'video/mp4' })
    const foreign = aMediaAsset({ kind: 'image', mimeType: 'image/png' })
    const f = build(project, shot, [video, foreign])

    for (const asset of [video, foreign]) {
      const res = await f.call('PUT', { mediaAssetId: asset.id })
      expect(res.status).toBe(422)
      expect(((await res.json()) as Err).fields?.['mediaAssetId']).toHaveLength(1)
    }
    expect(await f.shotReferences.findByShot(shot.id)).toEqual([])
  })
})
