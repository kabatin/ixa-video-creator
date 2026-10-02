import { BrandAssetId, LocationId, ProjectId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCATION_ID, MEDIA_ID, PROJECT_ID, WORKSPACE_ID, locationJson } from '@/__tests__/fixtures'
import { createLibraryClient, fieldErrorsOf } from '@/lib/library-api'

const BASE_URL = 'http://127.0.0.1:3001'

/** fixtures.ts に BrandAsset が無いのでここで持つ。ULID の形は他の fixture と揃える。 */
const BRAND_ASSET_ID = '01ARZ3NDEKTSV4RRFFQ69G5FE0'

const brandColorJson = {
  id: BRAND_ASSET_ID,
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  category: 'color',
  name: 'iXA Yellow',
  mediaAssetId: null,
  value: '#FFD200',
  usageRule: '見出しの下線に使う',
}

const brandAssetId = BrandAssetId.parse(BRAND_ASSET_ID)
const locationId = LocationId.parse(LOCATION_ID)
const projectId = ProjectId.parse(PROJECT_ID)

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const requestBodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined

const fetchMock = vi.fn<typeof fetch>()

const client = () => createLibraryClient(BASE_URL)

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BrandAsset の呼び出し口', () => {
  /** ブランド資産とロケーションはプロジェクトごと（ADR-0034）。 */
  it('一覧はプロジェクトの経路で引き、封筒を剥がしてパースする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [brandColorJson] }))

    const assets = await client().listBrandAssets(projectId)

    expect(assets).toHaveLength(1)
    expect(assets[0]?.value).toBe('#FFD200')

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/brand-assets`)
  })

  it('作成はプロジェクトの経路へ POST。省略した列は既定値を補って送る（ワークスペースは送らない）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: brandColorJson }, 201))

    const created = await client().createBrandAsset(projectId, {
      category: 'color',
      name: 'iXA Yellow',
      value: '#FFD200',
    })

    expect(created.id).toBe(BRAND_ASSET_ID)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/brand-assets`)
    expect(init?.method).toBe('POST')
    expect(requestBodyOf(init)).toEqual({
      category: 'color',
      name: 'iXA Yellow',
      mediaAssetId: null,
      value: '#FFD200',
      usageRule: '',
    })
  })

  it('更新は PATCH /brand-assets/{id} で渡した列だけを送る', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...brandColorJson, value: '#101010' } }),
    )

    const updated = await client().updateBrandAsset(brandAssetId, { value: '#101010' })

    expect(updated.value).toBe('#101010')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/brand-assets/${BRAND_ASSET_ID}`)
    expect(init?.method).toBe('PATCH')
    expect(requestBodyOf(init)).toEqual({ value: '#101010' })
  })

  it('削除は DELETE /brand-assets/{id}。204 は本文を読まない', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(client().deleteBrandAsset(brandAssetId)).resolves.toBeUndefined()

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/brand-assets/${BRAND_ASSET_ID}`)
    expect(init?.method).toBe('DELETE')
  })

  /**
   * 色の形式（#RRGGBB）の判定はサーバの `brandAssetFieldErrors` が唯一の正（lessons L-016）。
   * **画面側で先回りして弾かない。** 弾くと規則が 2 箇所になり、必ずズレる。
   */
  it('色の形式が不正でも画面側で止めず、サーバへ送って判定させる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: '入力の検証に失敗した',
          fields: { value: ['value は #RRGGBB 形式で指定してください'] },
        },
        422,
      ),
    )

    await expect(
      client().createBrandAsset(projectId, {
        category: 'color',
        name: 'iXA Yellow',
        value: 'きいろ',
      }),
    ).rejects.toThrow()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requestBodyOf(fetchMock.mock.calls[0]?.[1])).toMatchObject({ value: 'きいろ' })
  })
})

describe('Location の呼び出し口', () => {
  it('作成はプロジェクトの経路へ POST。参照画像は配列のまま送る', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: locationJson }, 201))

    const created = await client().createLocation(projectId, {
      name: '夜のスタジアム',
      description: 'ナイター照明',
      referenceAssetIds: [MEDIA_ID],
    })

    expect(created.referenceAssetIds).toEqual([MEDIA_ID])

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/locations`)
    expect(init?.method).toBe('POST')
    expect(requestBodyOf(init)).toEqual({
      name: '夜のスタジアム',
      description: 'ナイター照明',
      referenceAssetIds: [MEDIA_ID],
    })
  })

  it('更新は PATCH /locations/{id}', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...locationJson, referenceAssetIds: [] } }),
    )

    const updated = await client().updateLocation(locationId, { referenceAssetIds: [] })

    expect(updated.referenceAssetIds).toEqual([])

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/locations/${LOCATION_ID}`)
    expect(init?.method).toBe('PATCH')
    expect(requestBodyOf(init)).toEqual({ referenceAssetIds: [] })
  })

  it('削除は DELETE /locations/{id}', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await client().deleteLocation(locationId)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/locations/${LOCATION_ID}`)
    expect(init?.method).toBe('DELETE')
  })

  it('一覧は location-api の実装をそのまま束ねている', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [locationJson] }))

    await expect(client().listLocations(projectId)).resolves.toHaveLength(1)
  })
})

describe('Project 設定の呼び出し口', () => {
  it('更新は PATCH /projects/{id}。日時は Date へ戻す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          name: '改名後',
          fps: 30,
          resolution: { width: 1920, height: 1080 },
          aspectRatio: '16:9',
          durationSec: 116,
          budgetUsd: 250,
          styleGuide: '',
          status: 'production',
          createdAt: '2026-09-16T01:02:03.000Z',
          updatedAt: '2026-09-17T01:02:03.000Z',
        },
      }),
    )

    const updated = await client().updateProject(projectId, { name: '改名後', durationSec: 116 })

    expect(updated.name).toBe('改名後')
    expect(updated.updatedAt).toBeInstanceOf(Date)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}`)
    expect(init?.method).toBe('PATCH')
    expect(requestBodyOf(init)).toEqual({ name: '改名後', durationSec: 116 })
  })

  it('削除は DELETE /projects/{id}', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await client().deleteProject(projectId)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}`)
    expect(init?.method).toBe('DELETE')
  })
})

describe('fieldErrorsOf', () => {
  const failing = async (body: unknown, status: number): Promise<unknown> => {
    fetchMock.mockResolvedValue(jsonResponse(body, status))
    try {
      await client().listBrandAssets(projectId)
      return null
    } catch (error) {
      return error
    }
  }

  it('422 の fields をフィールド名 → メッセージへ畳む', async () => {
    const error = await failing(
      {
        success: false,
        error: '入力の検証に失敗した',
        fields: { value: ['value は #RRGGBB 形式で指定してください'] },
      },
      422,
    )

    expect(fieldErrorsOf(error)).toEqual({ value: 'value は #RRGGBB 形式で指定してください' })
  })

  it('1 フィールドに複数のメッセージがあれば連結する', async () => {
    const error = await failing(
      { success: false, error: 'だめ', fields: { name: ['短すぎます', '記号は使えません'] } },
      422,
    )

    expect(fieldErrorsOf(error)).toEqual({ name: '短すぎます / 記号は使えません' })
  })

  it('fields を持たない失敗は null（呼び出し側がまとめて 1 件で出す）', async () => {
    const error = await failing({ success: false, error: 'サーバ内部エラー' }, 500)

    expect(fieldErrorsOf(error)).toBeNull()
  })

  it('本文が JSON でなければ null', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }))
    const error = await client()
      .listBrandAssets(projectId)
      .then(() => null)
      .catch((cause: unknown) => cause)

    expect(fieldErrorsOf(error)).toBeNull()
  })

  it('ApiError でない値は null', () => {
    expect(fieldErrorsOf(new Error('通信断'))).toBeNull()
    expect(fieldErrorsOf(null)).toBeNull()
  })
})
