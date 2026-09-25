import {
  MediaAssetId as MediaAssetIdSchema,
  ProjectId as ProjectIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type MediaAsset,
} from '@ixa/domain'
import { createMemoryStorage, mediaKey } from '@ixa/storage'
import type { ObjectStorage } from '@ixa/storage'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createLogger } from '../logger.js'
import {
  DEFAULT_SIGNED_URL_EXPIRES_SEC,
  DERIVED_NOT_READY_MESSAGE,
  MAX_SIGNED_URL_EXPIRES_SEC,
  POSTERS_NOT_READY_MESSAGE,
  POSTER_INDEX_OUT_OF_RANGE_MESSAGE,
  type MediaAssetResponse,
} from '../routes/media.js'
import {
  createInMemoryMediaAssetRepository,
  type InMemoryMediaAssetRepository,
} from '@ixa/generation/testing'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { baseAppDeps } from './app-deps.js'

const logger = createLogger('silent')

type MediaBody = { success: true; data: MediaAssetResponse }
type ListBody = { success: true; data: MediaAssetResponse[]; meta: { total: number } }
type UrlBody = { success: true; data: { url: string; expiresInSec: number } }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

const buildApp = (mediaAssets: InMemoryMediaAssetRepository, storage: ObjectStorage) =>
  createApp({
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository(),
    mediaAssets,
    storage,
    logger,
  })

const CONTENT = new TextEncoder().encode('fake mp4 payload')

/** リポジトリに 1 件登録し、ストレージにも実体を置く。 */
const seedAsset = async (
  repo: InMemoryMediaAssetRepository,
  storage: ObjectStorage,
  overrides: { workspaceId?: string; projectId?: string | null; checksum?: string } = {},
): Promise<MediaAsset> => {
  const workspaceId = overrides.workspaceId ?? newId(WorkspaceIdSchema)
  const storageKey = mediaKey(workspaceId, newId(MediaAssetIdSchema), 'mp4')
  await storage.put(storageKey, CONTENT, { contentType: 'video/mp4' })
  return repo.create({
    workspaceId: WorkspaceIdSchema.parse(workspaceId),
    projectId:
      overrides.projectId === undefined
        ? null
        : overrides.projectId === null
          ? null
          : ProjectIdSchema.parse(overrides.projectId),
    kind: 'video',
    storageKey,
    mimeType: 'video/mp4',
    bytes: CONTENT.byteLength,
    checksumSha256: overrides.checksum ?? 'b'.repeat(64),
    origin: { type: 'upload', uploadedBy: 'editor' },
    tags: [],
  })
}

describe('GET /media/:id', () => {
  let repo: InMemoryMediaAssetRepository
  let storage: ObjectStorage

  beforeEach(() => {
    repo = createInMemoryMediaAssetRepository()
    storage = createMemoryStorage()
  })

  it('200 と MediaAsset を返す', async () => {
    const asset = await seedAsset(repo, storage)

    const res = await buildApp(repo, storage).request(`/media/${asset.id}`)

    expect(res.status).toBe(200)

    const json = (await res.json()) as MediaBody
    expect(json.data.id).toBe(asset.id)
    expect(json.data.storageKey).toBe(asset.storageKey)
    expect(json.data.createdAt).toBe(asset.createdAt.toISOString())
  })

  it('署名付き URL を本体に含めない（都度発行するため保存しない）', async () => {
    const asset = await seedAsset(repo, storage)

    const res = await buildApp(repo, storage).request(`/media/${asset.id}`)
    const raw = await res.text()

    expect(raw).not.toContain('memory://')
    expect(raw).not.toContain('"url"')
  })

  it('存在しない id は 404', async () => {
    const res = await buildApp(repo, storage).request(`/media/${newId(MediaAssetIdSchema)}`)

    expect(res.status).toBe(404)

    const json = (await res.json()) as ErrorBody
    expect(json.success).toBe(false)
  })

  it('ULID でない id は 422', async () => {
    const res = await buildApp(repo, storage).request('/media/not-a-ulid')

    expect(res.status).toBe(422)
  })
})

describe('GET /media/:id/url', () => {
  let repo: InMemoryMediaAssetRepository
  let storage: ObjectStorage

  beforeEach(() => {
    repo = createInMemoryMediaAssetRepository()
    storage = createMemoryStorage()
  })

  it('既定の有効期限で URL を発行する', async () => {
    const asset = await seedAsset(repo, storage)

    const res = await buildApp(repo, storage).request(`/media/${asset.id}/url`)

    expect(res.status).toBe(200)

    const json = (await res.json()) as UrlBody
    expect(json.data.url).toContain(asset.storageKey)
    expect(json.data.expiresInSec).toBe(DEFAULT_SIGNED_URL_EXPIRES_SEC)
    expect(DEFAULT_SIGNED_URL_EXPIRES_SEC).toBe(300)
  })

  it('呼ぶたびに URL を返し、DB には保存しない', async () => {
    const asset = await seedAsset(repo, storage)
    const app = buildApp(repo, storage)

    const first = (await (await app.request(`/media/${asset.id}/url`)).json()) as UrlBody
    const second = (await (await app.request(`/media/${asset.id}/url`)).json()) as UrlBody

    expect(first.data.url).toContain('memory://')
    expect(second.data.url).toContain('memory://')

    // 保持されている行に URL が焼き付いていないことを確かめる（CLAUDE.md 規約 7）。
    const stored = repo.snapshot()[0]
    expect(stored).toBeDefined()
    expect(JSON.stringify(stored)).not.toContain('memory://')
  })

  it('expiresInSec を指定できる', async () => {
    const asset = await seedAsset(repo, storage)

    const res = await buildApp(repo, storage).request(`/media/${asset.id}/url?expiresInSec=60`)

    expect(res.status).toBe(200)

    const json = (await res.json()) as UrlBody
    expect(json.data.expiresInSec).toBe(60)
    expect(json.data.url).toContain('expires=60')
  })

  it('上限を超える expiresInSec は 422', async () => {
    const asset = await seedAsset(repo, storage)

    const res = await buildApp(repo, storage).request(
      `/media/${asset.id}/url?expiresInSec=${String(MAX_SIGNED_URL_EXPIRES_SEC + 1)}`,
    )

    expect(res.status).toBe(422)
  })

  it('存在しない id は 404', async () => {
    const res = await buildApp(repo, storage).request(`/media/${newId(MediaAssetIdSchema)}/url`)

    expect(res.status).toBe(404)
  })
})

describe('GET /media/:id/url?variant=', () => {
  let repo: InMemoryMediaAssetRepository
  let storage: ObjectStorage

  beforeEach(() => {
    repo = createInMemoryMediaAssetRepository()
    storage = createMemoryStorage()
  })

  /** 派生物（サムネイル / ポスターフレーム）を後から埋める。取り込みキューと同じ経路。 */
  const withDerived = async (
    asset: MediaAsset,
    derived: { thumbnailKey?: string | null; posterKeys?: readonly string[] },
  ) => repo.update(asset.id, { ...derived, posterKeys: [...(derived.posterKeys ?? [])] })

  it('variant を省略すると従来どおり本体に署名する', async () => {
    const asset = await seedAsset(repo, storage)
    await withDerived(asset, { thumbnailKey: 'thumbs/one.jpg' })

    const json = (await (
      await buildApp(repo, storage).request(`/media/${asset.id}/url`)
    ).json()) as UrlBody

    expect(json.data.url).toContain(asset.storageKey)
    expect(json.data.url).not.toContain('thumbs/one.jpg')
  })

  it('variant=thumbnail は thumbnailKey に署名する', async () => {
    const asset = await seedAsset(repo, storage)
    await withDerived(asset, { thumbnailKey: 'thumbs/one.jpg' })

    const res = await buildApp(repo, storage).request(`/media/${asset.id}/url?variant=thumbnail`)

    expect(res.status).toBe(200)

    const json = (await res.json()) as UrlBody
    expect(json.data.url).toContain('thumbs/one.jpg')
    expect(json.data.expiresInSec).toBe(DEFAULT_SIGNED_URL_EXPIRES_SEC)
  })

  it('thumbnailKey がまだ無いときは 404 ではなく 409 と理由を返す', async () => {
    const asset = await seedAsset(repo, storage)

    const res = await buildApp(repo, storage).request(`/media/${asset.id}/url?variant=thumbnail`)

    expect(res.status).toBe(409)

    const json = (await res.json()) as ErrorBody
    expect(json.error).toBe(DERIVED_NOT_READY_MESSAGE)
  })

  it('variant=poster は index 既定 0 の posterKeys に署名する', async () => {
    const asset = await seedAsset(repo, storage)
    await withDerived(asset, { posterKeys: ['posters/0.jpg', 'posters/1.jpg'] })

    const first = (await (
      await buildApp(repo, storage).request(`/media/${asset.id}/url?variant=poster`)
    ).json()) as UrlBody
    expect(first.data.url).toContain('posters/0.jpg')

    const second = (await (
      await buildApp(repo, storage).request(`/media/${asset.id}/url?variant=poster&index=1`)
    ).json()) as UrlBody
    expect(second.data.url).toContain('posters/1.jpg')
  })

  it('index が範囲外なら 422', async () => {
    const asset = await seedAsset(repo, storage)
    await withDerived(asset, { posterKeys: ['posters/0.jpg'] })

    const res = await buildApp(repo, storage).request(
      `/media/${asset.id}/url?variant=poster&index=1`,
    )

    expect(res.status).toBe(422)

    const json = (await res.json()) as ErrorBody
    expect(json.error).toBe(POSTER_INDEX_OUT_OF_RANGE_MESSAGE)
  })

  it('posterKeys が空なら 409（範囲外とは別の状態）', async () => {
    const asset = await seedAsset(repo, storage)

    const res = await buildApp(repo, storage).request(`/media/${asset.id}/url?variant=poster`)

    expect(res.status).toBe(409)

    const json = (await res.json()) as ErrorBody
    expect(json.error).toBe(POSTERS_NOT_READY_MESSAGE)
    expect(POSTERS_NOT_READY_MESSAGE).not.toBe(POSTER_INDEX_OUT_OF_RANGE_MESSAGE)
  })

  it('負の index は 422', async () => {
    const asset = await seedAsset(repo, storage)
    await withDerived(asset, { posterKeys: ['posters/0.jpg'] })

    const res = await buildApp(repo, storage).request(
      `/media/${asset.id}/url?variant=poster&index=-1`,
    )

    expect(res.status).toBe(422)
  })

  it('知らない variant は 422', async () => {
    const asset = await seedAsset(repo, storage)

    const res = await buildApp(repo, storage).request(`/media/${asset.id}/url?variant=proxy`)

    expect(res.status).toBe(422)
  })

  it('存在しない id は variant を付けても 404', async () => {
    const res = await buildApp(repo, storage).request(
      `/media/${newId(MediaAssetIdSchema)}/url?variant=thumbnail`,
    )

    expect(res.status).toBe(404)
  })
})

describe('GET /media', () => {
  let repo: InMemoryMediaAssetRepository
  let storage: ObjectStorage

  beforeEach(() => {
    repo = createInMemoryMediaAssetRepository()
    storage = createMemoryStorage()
  })

  it('workspaceId で一覧を返す', async () => {
    const workspaceId = newId(WorkspaceIdSchema)
    await seedAsset(repo, storage, { workspaceId, checksum: 'c'.repeat(64) })
    await seedAsset(repo, storage, { workspaceId, checksum: 'd'.repeat(64) })
    await seedAsset(repo, storage, { checksum: 'e'.repeat(64) })

    const res = await buildApp(repo, storage).request(`/media?workspaceId=${workspaceId}`)

    expect(res.status).toBe(200)

    const json = (await res.json()) as ListBody
    expect(json.meta.total).toBe(2)
    expect(json.data.every((asset) => asset.workspaceId === workspaceId)).toBe(true)
  })

  it('projectId で絞り込める', async () => {
    const workspaceId = newId(WorkspaceIdSchema)
    const projectId = newId(ProjectIdSchema)
    await seedAsset(repo, storage, { workspaceId, projectId, checksum: 'c'.repeat(64) })
    await seedAsset(repo, storage, { workspaceId, checksum: 'd'.repeat(64) })

    const res = await buildApp(repo, storage).request(
      `/media?workspaceId=${workspaceId}&projectId=${projectId}`,
    )

    const json = (await res.json()) as ListBody
    expect(json.meta.total).toBe(1)
    expect(json.data[0]?.projectId).toBe(projectId)
  })

  it('workspaceId が無ければ 422', async () => {
    const res = await buildApp(repo, storage).request('/media')

    expect(res.status).toBe(422)
  })
})

describe('DELETE /media/:id', () => {
  let repo: InMemoryMediaAssetRepository
  let storage: ObjectStorage

  beforeEach(() => {
    repo = createInMemoryMediaAssetRepository()
    storage = createMemoryStorage()
  })

  it('204 を返し、行は消えるがストレージのオブジェクトは残る', async () => {
    const asset = await seedAsset(repo, storage)

    const res = await buildApp(repo, storage).request(`/media/${asset.id}`, { method: 'DELETE' })

    expect(res.status).toBe(204)
    expect(repo.snapshot()).toHaveLength(0)
    expect(await storage.exists(asset.storageKey)).toBe(true)
  })

  it('存在しない id は 404', async () => {
    const res = await buildApp(repo, storage).request(`/media/${newId(MediaAssetIdSchema)}`, {
      method: 'DELETE',
    })

    expect(res.status).toBe(404)
  })
})
