import { OpenAPIHono } from '@hono/zod-openapi'
import type { MediaAsset, Project, Shot } from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryMediaAssetRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { shotTakeImportRoutes } from '../routes/shot-take-import.js'
import type { TakeResponse } from '../routes/shots.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { aMediaAsset } from './in-memory-timeline-repositories.js'

/**
 * 手持ちの動画を Take にする（ADR-0026）。
 * アップロード済みの動画をそのまま Take の素材にする。Provider は通らず、費用は 0。
 */

type Ok<T> = { success: true; data: T }
type Err = { success: false; fields?: Record<string, string[]> }

const build = (project: Project, shot: Shot, assets: readonly MediaAsset[]) => {
  const deps = {
    shots: createInMemoryShotRepository([shot]),
    projects: createInMemoryProjectRepository([project]),
    mediaAssets: createInMemoryMediaAssetRepository([...assets]),
    takes: createInMemoryTakeRepository(),
    events: createInMemoryProjectEvents(),
    logger: createLogger('silent'),
  }
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, deps.logger)
  app.route('/', shotTakeImportRoutes(deps))
  const post = (body: unknown, shotId: string = shot.id) =>
    app.request(`/shots/${shotId}/takes/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { ...deps, post }
}

const setup = (shotOverrides: Partial<Shot> = {}) => {
  const project = aProject()
  const shot = aShot(project.id, shotOverrides)
  const video = aMediaAsset({
    workspaceId: project.workspaceId,
    probe: { durationSec: 6, width: 1280, height: 720, fps: 24, codec: 'h264', hasAudio: true },
  })
  return { project, shot, video }
}

describe('POST /shots/:id/takes/import', () => {
  it('アップロード済みの動画をそのまま Take にする（費用 0・作ったモデルを残す）', async () => {
    const { project, shot, video } = setup()
    const f = build(project, shot, [video])

    const res = await f.post({ mediaAssetId: video.id, sourceModel: 'Veo 3.1 Lite（推定）', fileName: '01_rain.mp4' })

    expect(res.status).toBe(201)
    const take = ((await res.json()) as Ok<TakeResponse>).data
    expect(take).toMatchObject({
      shotId: shot.id,
      mediaAssetId: video.id,
      providerId: 'import',
      modelId: 'import/footage',
      costUsd: 0,
      generationTimeSec: 0,
      providerParams: { kind: 'import', sourceModel: 'Veo 3.1 Lite（推定）', fileName: '01_rain.mp4' },
    })
    expect(await f.takes.findByShot(shot.id)).toHaveLength(1)
  })

  it('仕様は「持ち込み」として残す。尺は素材の長さ（後の生成と specHash が重ならない）', async () => {
    const { project, shot, video } = setup()
    const f = build(project, shot, [video])

    const take = ((await (await f.post({ mediaAssetId: video.id })).json()) as Ok<TakeResponse>).data

    expect(take.spec.sourceType).toBe('existing_footage')
    expect(take.spec.durationSec).toBe(6)
    expect(take.specHash).toMatch(/^[0-9a-f]{64}$/)
    // 同じ Shot を生成したときの仕様（ai_video）とは別のハッシュになる。
    expect(take.specHash).not.toBe(aTake(shot, 'x'.repeat(64)).specHash)
  })

  it('長さがまだ分からない素材は、Shot の尺で仕様を組む', async () => {
    const { project, shot } = setup()
    const unprobed = aMediaAsset({ workspaceId: project.workspaceId, probe: null })
    const f = build(project, shot, [unprobed])

    const take = ((await (await f.post({ mediaAssetId: unprobed.id })).json()) as Ok<TakeResponse>).data

    expect(take.spec.durationSec).toBe(shot.durationSec)
  })

  it('作ったモデルとファイル名は省略できる（分からなければ null）', async () => {
    const { project, shot, video } = setup()
    const f = build(project, shot, [video])

    const take = ((await (await f.post({ mediaAssetId: video.id })).json()) as Ok<TakeResponse>).data

    expect(take.providerParams).toEqual({ kind: 'import', sourceModel: null, fileName: null })
  })

  it('採用前の Shot は「採用待ち」になり、状態の変化を流す', async () => {
    const { project, shot, video } = setup()
    const f = build(project, shot, [video])

    await f.post({ mediaAssetId: video.id })

    expect((await f.shots.findById(shot.id))?.status).toBe('review')
    expect(f.events.published()).toMatchObject([{ type: 'shot.status', shotId: shot.id, status: 'review' }])
  })

  it('採用済みの Shot は採用済みのまま（採用は動かさない）', async () => {
    const { project, video } = setup()
    const adopted = aShot(project.id, { status: 'approved' })
    const existing = aTake(adopted, 'e'.repeat(64))
    const shot = { ...adopted, selectedTakeId: existing.id }
    const f = build(project, shot, [video])

    await f.post({ mediaAssetId: video.id })

    const after = await f.shots.findById(shot.id)
    expect(after?.status).toBe('approved')
    expect(after?.selectedTakeId).toBe(existing.id)
  })

  it('同じ動画を同じ Shot にもう一度取り込んでも、Take は増えない（既にある Take を返す）', async () => {
    const { project, shot, video } = setup()
    const f = build(project, shot, [video])

    const first = ((await (await f.post({ mediaAssetId: video.id })).json()) as Ok<TakeResponse>).data
    const again = await f.post({ mediaAssetId: video.id, sourceModel: 'Kling 3.0' })

    expect(again.status).toBe(200)
    expect(((await again.json()) as Ok<TakeResponse>).data.id).toBe(first.id)
    expect(await f.takes.findByShot(shot.id)).toHaveLength(1)
  })

  it('動画でなければ 422（画像は「最初のフレーム」で付ける）', async () => {
    const { project, shot } = setup()
    const image = aMediaAsset({ workspaceId: project.workspaceId, kind: 'image', mimeType: 'image/png' })
    const f = build(project, shot, [image])

    const res = await f.post({ mediaAssetId: image.id })

    expect(res.status).toBe(422)
    expect(Object.keys(((await res.json()) as Err).fields ?? {})).toContain('mediaAssetId')
    expect(await f.takes.findByShot(shot.id)).toHaveLength(0)
  })

  it('別のワークスペースの動画は 422', async () => {
    const { project, shot } = setup()
    const foreign = aMediaAsset()
    const f = build(project, shot, [foreign])

    const res = await f.post({ mediaAssetId: foreign.id })

    expect(res.status).toBe(422)
    expect(await f.takes.findByShot(shot.id)).toHaveLength(0)
  })

  it('生成中の Shot は 409（生成が終われば状態は worker が進める）', async () => {
    const { project, shot, video } = setup({ status: 'generating' })
    const f = build(project, shot, [video])

    const res = await f.post({ mediaAssetId: video.id })

    expect(res.status).toBe(409)
    expect(await f.takes.findByShot(shot.id)).toHaveLength(0)
  })

  it('空のモデル名は弾く（分からなければ null を送る）', async () => {
    const { project, shot, video } = setup()
    const f = build(project, shot, [video])

    expect((await f.post({ mediaAssetId: video.id, sourceModel: '  ' })).status).toBe(422)
  })

  it('存在しない Shot は 404', async () => {
    const { project, shot, video } = setup()
    const f = build(project, shot, [video])

    const res = await f.post({ mediaAssetId: video.id }, aShot(project.id).id)

    expect(res.status).toBe(404)
  })
})
