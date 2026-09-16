import { LocationId, ShotId, WorkspaceId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCATION_ID, SHOT_ID, WORKSPACE_ID, locationJson, shotJson } from '@/__tests__/fixtures'
import { createApiClient } from '@/lib/api-client'

const BASE_URL = 'http://127.0.0.1:3001'

const workspaceId = WorkspaceId.parse(WORKSPACE_ID)
const locationId = LocationId.parse(LOCATION_ID)
const shotId = ShotId.parse(SHOT_ID)

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const requestBodyOf = (init: RequestInit | undefined): string =>
  typeof init?.body === 'string' ? init.body : ''

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('location API', () => {
  it('listLocations は workspaceId で絞り、封筒を剥がしてパースする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [locationJson] }))

    const locations = await createApiClient(BASE_URL).listLocations(workspaceId)

    expect(locations).toHaveLength(1)
    expect(locations[0]?.name).toBe('夜のスタジアム')
    expect(locations[0]?.referenceAssetIds).toHaveLength(1)

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/locations?workspaceId=${WORKSPACE_ID}`)
  })

  it('一覧が空でもそのまま空配列で返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))

    await expect(createApiClient(BASE_URL).listLocations(workspaceId)).resolves.toEqual([])
  })
})

describe('updateShot によるロケーションの付け外し', () => {
  it('locationId を既存の Shot 更新経路で送る', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...shotJson, locationId: LOCATION_ID } }),
    )

    const updated = await createApiClient(BASE_URL).updateShot(shotId, { locationId })

    expect(updated.locationId).toBe(LOCATION_ID)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/shots/${SHOT_ID}`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(requestBodyOf(init))).toEqual({ locationId: LOCATION_ID })
  })

  it('null を送ればロケーションを外せる', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: shotJson }))

    const updated = await createApiClient(BASE_URL).updateShot(shotId, { locationId: null })

    expect(updated.locationId).toBeNull()
    expect(JSON.parse(requestBodyOf(fetchMock.mock.calls[0]?.[1]))).toEqual({ locationId: null })
  })
})
