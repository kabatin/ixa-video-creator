import { OpenAPIHono } from '@hono/zod-openapi'
import {
  BrandAssetId as BrandAssetIdSchema,
  LocationId as LocationIdSchema,
  MediaAsset as MediaAssetSchema,
  MediaAssetId as MediaAssetIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type MediaAsset,
  type WorkspaceId,
} from '@ixa/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { assetRoutes, type AssetRoutesDeps } from '../routes/assets.js'
import {
  createInMemoryBrandAssetRepository,
  createInMemoryLocationRepository,
  createInMemoryMediaAssetRepository,
  type InMemoryBrandAssetRepository,
  type InMemoryLocationRepository,
} from '@ixa/generation/testing'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

type SuccessBody<T> = { success: true; data: T }
type ListBody<T> = { success: true; data: T[]; meta: { total: number } }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

type BrandBody = {
  id: string
  category: string
  name: string
  value: string | null
  mediaAssetId: string | null
}
type LocationBody = { id: string; name: string; referenceAssetIds: string[] }

const workspaceId = WorkspaceIdSchema.parse(newId(WorkspaceIdSchema))
/** ブランド資産とロケーションはプロジェクトごと（ADR-0034）。同じワークスペースにプロジェクトを 2 つ置く。 */
const project = aProject({ workspaceId })
const otherProject = aProject({ workspaceId, name: 'LUNA BREW 30秒CM' })
const BRAND_ASSETS_PATH = `/projects/${project.id}/brand-assets`
const LOCATIONS_PATH = `/projects/${project.id}/locations`

/** テスト用のロゴ画像。参照先が実在することを示すためだけに使う。 */
const aLogoAsset = (ws: WorkspaceId): MediaAsset =>
  MediaAssetSchema.parse({
    id: newId(MediaAssetIdSchema),
    workspaceId: ws,
    projectId: null,
    kind: 'image',
    storageKey: `${ws}/logo.png`,
    mimeType: 'image/png',
    bytes: 1024,
    checksumSha256: 'c'.repeat(64),
    probe: null,
    proxyKey: null,
    thumbnailKey: null,
    posterKeys: [],
    lastFrameAssetId: null,
    origin: { type: 'upload', uploadedBy: 'tester' },
    tags: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })

let brandAssets: InMemoryBrandAssetRepository
let locations: InMemoryLocationRepository
let logo: MediaAsset

const buildApp = (deps: AssetRoutesDeps) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', assetRoutes(deps))
  registerErrorHandlers(app, createLogger('silent'))
  return app
}

let app: ReturnType<typeof buildApp>

const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

beforeEach(() => {
  brandAssets = createInMemoryBrandAssetRepository()
  locations = createInMemoryLocationRepository()
  logo = aLogoAsset(workspaceId)
  app = buildApp({
    brandAssets,
    locations,
    mediaAssets: createInMemoryMediaAssetRepository([logo]),
    projects: createInMemoryProjectRepository([project, otherProject]),
  })
})

describe('BrandAsset の組み合わせ規則', () => {
  it('category=color は value（#RRGGBB）で作成できる', async () => {
    const res = await send('POST', BRAND_ASSETS_PATH, {
      category: 'color',
      name: 'iXA Yellow',
      value: '#FFD200',
    })
    expect(res.status).toBe(201)
    const created = await json<SuccessBody<BrandBody>>(res)
    expect(created.data.value).toBe('#FFD200')
    expect(created.data.mediaAssetId).toBeNull()
  })

  it('category=color で value が無いと 422', async () => {
    const res = await send('POST', BRAND_ASSETS_PATH, {
      category: 'color',
      name: 'iXA Yellow',
    })
    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.value).toBeDefined()
  })

  it('category=color で value が #RRGGBB 形式でないと 422', async () => {
    const res = await send('POST', BRAND_ASSETS_PATH, {
      category: 'color',
      name: 'iXA Yellow',
      value: 'yellow',
    })
    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.value).toBeDefined()
  })

  it('color 以外は mediaAssetId が必須（無ければ 422）', async () => {
    const res = await send('POST', BRAND_ASSETS_PATH, {
      category: 'logo',
      name: 'iXA ロゴ',
    })
    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.mediaAssetId).toBeDefined()
  })

  it('color 以外で mediaAssetId があれば作成できる', async () => {
    const res = await send('POST', BRAND_ASSETS_PATH, {
      category: 'logo',
      name: 'iXA ロゴ',
      mediaAssetId: logo.id,
      usageRule: 'ロゴは左上、最小マージン 40px',
    })
    expect(res.status).toBe(201)
    expect((await json<SuccessBody<BrandBody>>(res)).data.mediaAssetId).toBe(logo.id)
  })

  it('存在しない MediaAsset を参照すると 422', async () => {
    const res = await send('POST', BRAND_ASSETS_PATH, {
      category: 'logo',
      name: 'iXA ロゴ',
      mediaAssetId: newId(MediaAssetIdSchema),
    })
    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.mediaAssetId).toBeDefined()
  })

  it('PATCH は更新後の姿で判定する（color へ変えて value が無ければ 422）', async () => {
    const created = await json<SuccessBody<BrandBody>>(
      await send('POST', BRAND_ASSETS_PATH, {
        category: 'logo',
        name: 'iXA ロゴ',
        mediaAssetId: logo.id,
      }),
    )

    const bad = await send('PATCH', `/brand-assets/${created.data.id}`, { category: 'color' })
    expect(bad.status).toBe(422)

    const good = await send('PATCH', `/brand-assets/${created.data.id}`, {
      category: 'color',
      value: '#1A1A1A',
    })
    expect(good.status).toBe(200)
    expect((await json<SuccessBody<BrandBody>>(good)).data.value).toBe('#1A1A1A')
  })
})

describe('BrandAsset の一覧と削除', () => {
  it('プロジェクトで絞り込み、DELETE は 204', async () => {
    const created = await json<SuccessBody<BrandBody>>(
      await send('POST', BRAND_ASSETS_PATH, {
        category: 'color',
        name: 'iXA Yellow',
        value: '#FFD200',
      }),
    )

    const list = await json<ListBody<BrandBody>>(
      await send('GET', BRAND_ASSETS_PATH),
    )
    expect(list.meta.total).toBe(1)

    const other = await json<ListBody<BrandBody>>(
      await send('GET', `/projects/${otherProject.id}/brand-assets`),
    )
    expect(other.meta.total).toBe(0)

    expect((await send('DELETE', `/brand-assets/${created.data.id}`)).status).toBe(204)
    expect(brandAssets.snapshot()).toHaveLength(0)
  })

  it('存在しない id は 404', async () => {
    const missing = newId(BrandAssetIdSchema)
    expect((await send('PATCH', `/brand-assets/${missing}`, { name: 'x' })).status).toBe(404)
    expect((await send('DELETE', `/brand-assets/${missing}`)).status).toBe(404)
  })
})

/** 作るとパスのプロジェクトに入り、ワークスペースはプロジェクトから入る。ワークスペースで引く口は無い（ADR-0034）。 */
describe('プロジェクトごと', () => {
  it('作ったものは持ち主のプロジェクトとワークスペースを持ち、ほかのプロジェクトの一覧には出ない', async () => {
    const brand = await json<SuccessBody<BrandBody & { projectId: string; workspaceId: string }>>(
      await send('POST', BRAND_ASSETS_PATH, { category: 'color', name: 'iXA Yellow', value: '#FFD200' }),
    )
    const location = await json<SuccessBody<LocationBody & { projectId: string; workspaceId: string }>>(
      await send('POST', LOCATIONS_PATH, { name: 'iXA CUP 会場' }),
    )

    expect([brand.data.projectId, brand.data.workspaceId]).toEqual([project.id, workspaceId])
    expect([location.data.projectId, location.data.workspaceId]).toEqual([project.id, workspaceId])
    const others = await json<ListBody<LocationBody>>(await send('GET', `/projects/${otherProject.id}/locations`))
    expect(others.meta.total).toBe(0)
  })

  it('無いプロジェクトは 404。ワークスペースで引く口は無い', async () => {
    const missing = aProject()
    expect((await send('GET', `/projects/${missing.id}/brand-assets`)).status).toBe(404)
    expect((await send('POST', `/projects/${missing.id}/locations`, { name: 'x' })).status).toBe(404)
    expect((await send('GET', `/brand-assets?workspaceId=${workspaceId}`)).status).toBe(404)
    expect((await send('GET', `/locations?workspaceId=${workspaceId}`)).status).toBe(404)
  })
})

describe('Location', () => {
  it('作成・一覧・更新・削除ができる', async () => {
    const created = await json<SuccessBody<LocationBody>>(
      await send('POST', LOCATIONS_PATH, {
        name: 'iXA CUP 会場',
        description: '2019 年の決勝ステージ',
        referenceAssetIds: [logo.id],
      }),
    )
    expect(created.data.referenceAssetIds).toEqual([logo.id])

    const list = await json<ListBody<LocationBody>>(
      await send('GET', LOCATIONS_PATH),
    )
    expect(list.meta.total).toBe(1)

    const patched = await json<SuccessBody<LocationBody>>(
      await send('PATCH', `/locations/${created.data.id}`, { name: 'iXA CUP 会場（改修後）' }),
    )
    expect(patched.data.name).toBe('iXA CUP 会場（改修後）')

    expect((await send('DELETE', `/locations/${created.data.id}`)).status).toBe(204)
    expect(locations.snapshot()).toHaveLength(0)
  })

  it('存在しない MediaAsset を参照すると 422', async () => {
    const res = await send('POST', LOCATIONS_PATH, {
      name: 'iXA CUP 会場',
      referenceAssetIds: [newId(MediaAssetIdSchema)],
    })
    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.referenceAssetIds).toBeDefined()
  })

  it('存在しない id は 404', async () => {
    const missing = newId(LocationIdSchema)
    expect((await send('PATCH', `/locations/${missing}`, { name: 'x' })).status).toBe(404)
    expect((await send('DELETE', `/locations/${missing}`)).status).toBe(404)
  })
})
