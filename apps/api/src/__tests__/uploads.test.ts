import { WorkspaceId as WorkspaceIdSchema, newId } from '@ixa/domain'
import { createMemoryStorage } from '@ixa/storage'
import type { ObjectStorage } from '@ixa/storage'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createLogger } from '../logger.js'
import type { MediaAssetResponse } from '../routes/media.js'
import { MAX_UPLOAD_BYTES, UPLOAD_URL_EXPIRES_SEC } from '../routes/uploads.js'
import {
  createInMemoryMediaAssetRepository,
  type InMemoryMediaAssetRepository,
} from './in-memory-media-asset-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { baseAppDeps } from './app-deps.js'

const logger = createLogger('silent')

type SignData = {
  mediaAssetId: string
  storageKey: string
  uploadUrl: string
  expiresInSec: number
}
type SignBody = { success: true; data: SignData }
type MediaBody = { success: true; data: MediaAssetResponse }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

const buildApp = (mediaAssets: InMemoryMediaAssetRepository, storage: ObjectStorage) =>
  createApp({
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository(),
    mediaAssets,
    storage,
    logger,
  })

const postJson = (app: ReturnType<typeof buildApp>, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const CHECKSUM = 'a'.repeat(64)
const CONTENT = new TextEncoder().encode('fake mp4 payload')

const signBody = (workspaceId: string, overrides: Record<string, unknown> = {}) => ({
  workspaceId,
  projectId: null,
  kind: 'video',
  fileName: 'take-01.mp4',
  contentType: 'video/mp4',
  bytes: CONTENT.byteLength,
  ...overrides,
})

const completeBody = (
  workspaceId: string,
  sign: SignData,
  overrides: Record<string, unknown> = {},
) => ({
  mediaAssetId: sign.mediaAssetId,
  workspaceId,
  projectId: null,
  kind: 'video',
  storageKey: sign.storageKey,
  mimeType: 'video/mp4',
  bytes: CONTENT.byteLength,
  checksumSha256: CHECKSUM,
  uploadedBy: 'h.kabayama',
  ...overrides,
})

describe('POST /uploads/sign', () => {
  let repo: InMemoryMediaAssetRepository
  let storage: ObjectStorage
  let workspaceId: string

  beforeEach(() => {
    repo = createInMemoryMediaAssetRepository()
    storage = createMemoryStorage()
    workspaceId = newId(WorkspaceIdSchema)
  })

  it('200 と mediaAssetId / storageKey / 15 分有効の URL を返す', async () => {
    const res = await postJson(buildApp(repo, storage), '/uploads/sign', signBody(workspaceId))

    expect(res.status).toBe(200)

    const json = (await res.json()) as SignBody
    expect(json.data.mediaAssetId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(json.data.storageKey).toBe(`media/${workspaceId}/${json.data.mediaAssetId}/original.mp4`)
    expect(json.data.uploadUrl).toContain(json.data.storageKey)
    expect(json.data.expiresInSec).toBe(UPLOAD_URL_EXPIRES_SEC)
    expect(UPLOAD_URL_EXPIRES_SEC).toBe(900)
  })

  it('署名付き URL を DB に保存しない（この時点で MediaAsset を作らない）', async () => {
    await postJson(buildApp(repo, storage), '/uploads/sign', signBody(workspaceId))

    expect(repo.snapshot()).toHaveLength(0)
  })

  it('拡張子の無いファイル名は 422', async () => {
    const res = await postJson(
      buildApp(repo, storage),
      '/uploads/sign',
      signBody(workspaceId, { fileName: 'take-01' }),
    )

    expect(res.status).toBe(422)

    const json = (await res.json()) as ErrorBody
    expect(json.success).toBe(false)
    expect(json.fields?.fileName).toBeDefined()
  })

  it('contentType と kind が食い違えば 422', async () => {
    const res = await postJson(
      buildApp(repo, storage),
      '/uploads/sign',
      signBody(workspaceId, { kind: 'video', contentType: 'image/png' }),
    )

    expect(res.status).toBe(422)

    const json = (await res.json()) as ErrorBody
    expect(json.fields?.contentType).toBeDefined()
  })

  it('上限を超える bytes は 422', async () => {
    const res = await postJson(
      buildApp(repo, storage),
      '/uploads/sign',
      signBody(workspaceId, { bytes: MAX_UPLOAD_BYTES + 1 }),
    )

    expect(res.status).toBe(422)

    const json = (await res.json()) as ErrorBody
    expect(json.fields?.bytes).toBeDefined()
  })

  it('上限ちょうどの bytes は受け付ける', async () => {
    const res = await postJson(
      buildApp(repo, storage),
      '/uploads/sign',
      signBody(workspaceId, { bytes: MAX_UPLOAD_BYTES }),
    )

    expect(res.status).toBe(200)
  })

  it('kind=other は任意の contentType を許す', async () => {
    const res = await postJson(
      buildApp(repo, storage),
      '/uploads/sign',
      signBody(workspaceId, { kind: 'other', contentType: 'application/zip', fileName: 'a.zip' }),
    )

    expect(res.status).toBe(200)
  })
})

describe('POST /uploads/complete', () => {
  let repo: InMemoryMediaAssetRepository
  let storage: ObjectStorage
  let workspaceId: string

  beforeEach(() => {
    repo = createInMemoryMediaAssetRepository()
    storage = createMemoryStorage()
    workspaceId = newId(WorkspaceIdSchema)
  })

  /** sign を呼び、ストレージに実体を置いた状態を作る。 */
  const signAndUpload = async (app: ReturnType<typeof buildApp>): Promise<SignData> => {
    const res = await postJson(app, '/uploads/sign', signBody(workspaceId))
    const json = (await res.json()) as SignBody
    await storage.put(json.data.storageKey, CONTENT, { contentType: 'video/mp4' })
    return json.data
  }

  it('201 と登録された MediaAsset を返す', async () => {
    const app = buildApp(repo, storage)
    const sign = await signAndUpload(app)

    const res = await postJson(app, '/uploads/complete', completeBody(workspaceId, sign))

    expect(res.status).toBe(201)

    const json = (await res.json()) as MediaBody
    expect(json.data.storageKey).toBe(sign.storageKey)
    expect(json.data.bytes).toBe(CONTENT.byteLength)
    expect(json.data.checksumSha256).toBe(CHECKSUM)
    expect(json.data.origin).toEqual({ type: 'upload', uploadedBy: 'h.kabayama' })
    expect(repo.snapshot()).toHaveLength(1)
  })

  it('ストレージに実体が無ければ 404', async () => {
    const app = buildApp(repo, storage)
    const res = await postJson(app, '/uploads/sign', signBody(workspaceId))
    const sign = ((await res.json()) as SignBody).data

    const completed = await postJson(app, '/uploads/complete', completeBody(workspaceId, sign))

    expect(completed.status).toBe(404)
    expect(repo.snapshot()).toHaveLength(0)
  })

  it('申告された bytes が実際と食い違えば 422（申告を信用しない）', async () => {
    const app = buildApp(repo, storage)
    const sign = await signAndUpload(app)

    const res = await postJson(
      app,
      '/uploads/complete',
      completeBody(workspaceId, sign, { bytes: CONTENT.byteLength + 1 }),
    )

    expect(res.status).toBe(422)

    const json = (await res.json()) as ErrorBody
    expect(json.fields?.bytes).toBeDefined()
    expect(repo.snapshot()).toHaveLength(0)
  })

  it('同じ checksum の二重 complete は重複を作らず 200 で既存を返す', async () => {
    const app = buildApp(repo, storage)
    const first = await signAndUpload(app)
    const second = await signAndUpload(app)

    const created = await postJson(app, '/uploads/complete', completeBody(workspaceId, first))
    expect(created.status).toBe(201)
    const createdJson = (await created.json()) as MediaBody

    const again = await postJson(app, '/uploads/complete', completeBody(workspaceId, second))

    expect(again.status).toBe(200)

    const againJson = (await again.json()) as MediaBody
    expect(againJson.data.id).toBe(createdJson.data.id)
    expect(againJson.data.storageKey).toBe(createdJson.data.storageKey)
    expect(repo.snapshot()).toHaveLength(1)
  })

  it('storageKey が workspaceId / mediaAssetId と一致しなければ 422', async () => {
    const app = buildApp(repo, storage)
    const sign = await signAndUpload(app)
    const otherWorkspaceId = newId(WorkspaceIdSchema)

    const res = await postJson(
      app,
      '/uploads/complete',
      completeBody(workspaceId, sign, {
        storageKey: `media/${otherWorkspaceId}/${sign.mediaAssetId}/original.mp4`,
      }),
    )

    expect(res.status).toBe(422)

    const json = (await res.json()) as ErrorBody
    expect(json.fields?.storageKey).toBeDefined()
  })

  it('checksum が 64 桁の 16 進数でなければ 422', async () => {
    const app = buildApp(repo, storage)
    const sign = await signAndUpload(app)

    const res = await postJson(
      app,
      '/uploads/complete',
      completeBody(workspaceId, sign, { checksumSha256: 'short' }),
    )

    expect(res.status).toBe(422)
  })
})
