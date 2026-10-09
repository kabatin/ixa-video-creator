import { OpenAPIHono } from '@hono/zod-openapi'
import { MediaAssetId as MediaAssetIdSchema, WorkspaceId as WorkspaceIdSchema, newId } from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryMediaAssetRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { createMemoryStorage, mediaKey } from '@ixa/storage'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { attachmentHeader, takeDownloadRoutes } from '../routes/take-download.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/** 制作者 2026-10-09「Take の動画を個別に DL できるようにしたい」。読める名前で保存させる。 */
const CONTENT = new TextEncoder().encode('take-mp4-bytes')

const buildFixture = async () => {
  const project = aProject({ name: '進め！戦子ちゃん！4' })
  const storage = createMemoryStorage()
  const mediaAssets = createInMemoryMediaAssetRepository()
  const storageKey = mediaKey(newId(WorkspaceIdSchema), newId(MediaAssetIdSchema), 'mp4')
  await storage.put(storageKey, CONTENT, { contentType: 'video/mp4' })
  const asset = await mediaAssets.create({
    workspaceId: project.workspaceId,
    projectId: project.id,
    kind: 'video',
    storageKey,
    mimeType: 'video/mp4',
    bytes: CONTENT.byteLength,
    checksumSha256: 'b'.repeat(64),
    origin: { type: 'upload', uploadedBy: 'test' },
    tags: [],
  })

  const base = aShot(project.id, { code: 'CUT-06' })
  const take = aTake(base, 'a'.repeat(64), { mediaAssetId: asset.id, index: 1 })
  const shot = { ...base, selectedTakeId: take.id }
  /** **同じ作品の別の Shot。** 「その Shot の Take か」を実在する Shot で試すために要る。 */
  const otherShot = aShot(project.id, { code: 'OTHER', order: 9000 })
  const takes = createInMemoryTakeRepository()
  await takes.create(take)

  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    takeDownloadRoutes({
      shots: createInMemoryShotRepository([shot, otherShot]),
      takes,
      projects: createInMemoryProjectRepository([project]),
      mediaAssets,
      storage,
    }),
  )
  return { app, shot, otherShot, take }
}

describe('GET /shots/{shotId}/takes/{takeId}/download', () => {
  it('中身を、作品名・Shot・Take 番号・採用が読める名前で返す', async () => {
    const { app, shot, take } = await buildFixture()

    const res = await app.request(`/shots/${shot.id}/takes/${take.id}/download`)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('content-length')).toBe(String(CONTENT.byteLength))
    expect(res.headers.get('content-disposition')).toContain(
      `filename*=UTF-8''${encodeURIComponent('進め！戦子ちゃん！4 CUT-06 Take 1 採用.mp4')}`,
    )
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(CONTENT)
  })

  it('別の Shot の Take は断る（URL の Shot と食い違うものを返さない）', async () => {
    const { app, otherShot, take } = await buildFixture()

    const res = await app.request(`/shots/${otherShot.id}/takes/${take.id}/download`)

    expect(res.status).toBe(404)
  })

  it('無い Take は 404', async () => {
    const { app, shot } = await buildFixture()
    const res = await app.request(`/shots/${shot.id}/takes/01ARZ3NDEKTSV4RRFFQ69G5FAV/download`)
    expect(res.status).toBe(404)
  })
})

describe('attachmentHeader', () => {
  it('古い相手向けの filename は ASCII だけ・引用符を壊さない', () => {
    const header = attachmentHeader('作品 "A" CUT-01.mp4')
    const ascii = /filename="([^"]*)"/.exec(header)?.[1] ?? ''
    expect(ascii).toMatch(/^[\x20-\x7e]+$/)
    expect(ascii).not.toContain('"')
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('作品 "A" CUT-01.mp4')}`)
  })
})
