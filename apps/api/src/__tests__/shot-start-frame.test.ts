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
import { shotStartFrameRoutes } from '../routes/shot-start-frame.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { aMediaAsset } from './in-memory-timeline-repositories.js'

/**
 * Shot の最初のフレーム（ADR-0025）。画像を 1 枚付け、ローカルの画像→動画で Take にする。
 * 中身は手動の参照 `start_frame` 1 件。生成は既存の経路（context.ts）がそのまま拾う。
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
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route('/', shotStartFrameRoutes(deps))
  const call = (method: string, body?: unknown) =>
    app.request(`/shots/${shot.id}/start-frame`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  return { ...deps, call }
}

const setup = () => {
  const project = aProject()
  const shot = aShot(project.id)
  const image = aMediaAsset({ workspaceId: project.workspaceId, kind: 'image', mimeType: 'image/png' })
  return { project, shot, image }
}

describe('/shots/:id/start-frame', () => {
  it('付ける前は null', async () => {
    const { project, shot, image } = setup()
    const f = build(project, shot, [image])

    const res = await f.call('GET')

    expect(((await res.json()) as Ok<{ mediaAssetId: string | null }>).data.mediaAssetId).toBeNull()
  })

  it('画像を付けると、手動の start_frame 参照が 1 件になる', async () => {
    const { project, shot, image } = setup()
    const f = build(project, shot, [image])

    const res = await f.call('PUT', { mediaAssetId: image.id })

    expect(res.status).toBe(200)
    const refs = await f.shotReferences.findByShot(shot.id)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ mediaAssetId: image.id, role: 'start_frame', sourceKind: 'manual' })
    expect(((await (await f.call('GET')).json()) as Ok<{ mediaAssetId: string }>).data.mediaAssetId).toBe(image.id)
  })

  it('付け直すと置き換わる（2 枚にならない）', async () => {
    const { project, shot, image } = setup()
    const other = aMediaAsset({ workspaceId: project.workspaceId, kind: 'image', mimeType: 'image/jpeg' })
    const f = build(project, shot, [image, other])

    await f.call('PUT', { mediaAssetId: image.id })
    await f.call('PUT', { mediaAssetId: other.id })

    const refs = await f.shotReferences.findByShot(shot.id)
    expect(refs.map((r) => r.mediaAssetId)).toEqual([other.id])
  })

  it('外すと消える', async () => {
    const { project, shot, image } = setup()
    const f = build(project, shot, [image])
    await f.call('PUT', { mediaAssetId: image.id })

    const res = await f.call('DELETE')

    expect(res.status).toBe(204)
    expect(await f.shotReferences.findByShot(shot.id)).toHaveLength(0)
  })

  it('画像でない素材は 422', async () => {
    const { project, shot } = setup()
    const video = aMediaAsset({ workspaceId: project.workspaceId, kind: 'video' })
    const f = build(project, shot, [video])

    const res = await f.call('PUT', { mediaAssetId: video.id })

    expect(res.status).toBe(422)
    expect(((await res.json()) as Err).fields?.mediaAssetId?.[0]).toContain('画像')
  })

  it('別のワークスペースの画像は 422', async () => {
    const { project, shot } = setup()
    const foreign = aMediaAsset({ kind: 'image', mimeType: 'image/png' })
    const f = build(project, shot, [foreign])

    const res = await f.call('PUT', { mediaAssetId: foreign.id })

    expect(res.status).toBe(422)
    expect(await f.shotReferences.findByShot(shot.id)).toHaveLength(0)
  })

  it('手動で付けた他の参照は消さない', async () => {
    const { project, shot, image } = setup()
    const f = build(project, shot, [image])
    const subject = aMediaAsset({ workspaceId: project.workspaceId, kind: 'image', mimeType: 'image/png' })
    await f.shotReferences.create({ shotId: shot.id, mediaAssetId: subject.id, role: 'subject', weight: 1, order: 0, sourceKind: 'manual' })

    await f.call('PUT', { mediaAssetId: image.id })
    await f.call('DELETE')

    expect((await f.shotReferences.findByShot(shot.id)).map((r) => r.role)).toEqual(['subject'])
  })
})
