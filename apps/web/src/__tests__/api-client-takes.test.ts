import { MediaAssetId, ShotId, TakeId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@/lib/api-client'
import { MEDIA_ID, SHOT_ID, TAKE_ID, generateResultJson, shotJson, takeJson } from './fixtures'

const BASE_URL = 'http://127.0.0.1:3001'

const shotId = ShotId.parse(SHOT_ID)
const takeId = TakeId.parse(TAKE_ID)
const mediaId = MediaAssetId.parse(MEDIA_ID)

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const requestBodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generateTakes / listTakes / selectTake', () => {
  it('generateTakes は 202 の本文を検証して返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: generateResultJson }, 202))

    const result = await createApiClient(BASE_URL).generateTakes(shotId, {
      model: 'AUTO',
      count: 2,
    })

    expect(result.jobIds).toHaveLength(1)
    expect(result.duplicateOfTakeId).toBeNull()
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/shots/${SHOT_ID}/generate`)
    expect(requestBodyOf(init)).toEqual({ model: 'AUTO', count: 2 })
  })

  it('generateTakes は上限を超える本数を送る前に弾く', async () => {
    await expect(
      createApiClient(BASE_URL).generateTakes(shotId, { model: 'AUTO', count: 5 }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('listTakes は Take をパースする', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [takeJson], meta: { total: 1 } }),
    )

    const takes = await createApiClient(BASE_URL).listTakes(shotId)

    expect(takes[0]?.index).toBe(1)
    expect(takes[0]?.costUsd).toBe(0.35)
    expect(takes[0]?.createdAt).toBeInstanceOf(Date)
  })

  it('specHash の長さが違う Take は zod が throw する', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...takeJson, specHash: 'short' }] }),
    )

    await expect(createApiClient(BASE_URL).listTakes(shotId)).rejects.toThrow()
  })

  it('selectTake は takeId を送って更新後の Shot を返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { ...shotJson, selectedTakeId: TAKE_ID, status: 'review' },
      }),
    )

    const updated = await createApiClient(BASE_URL).selectTake(shotId, takeId)

    expect(updated.selectedTakeId).toBe(TAKE_ID)
    expect(updated.status).toBe('review')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/shots/${SHOT_ID}/select-take`)
    expect(requestBodyOf(init)).toEqual({ takeId: TAKE_ID })
  })
})

describe('mediaUrl', () => {
  it('署名付き URL と有効期限を返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { url: 'https://example.com/a.mp4', expiresInSec: 300 },
      }),
    )

    const issued = await createApiClient(BASE_URL).mediaUrl(mediaId)

    expect(issued.url).toBe('https://example.com/a.mp4')
    expect(issued.expiresInSec).toBe(300)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/media/${MEDIA_ID}/url`)
  })

  it('url が空のレスポンスは zod が throw する', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { url: '', expiresInSec: 300 } }),
    )

    await expect(createApiClient(BASE_URL).mediaUrl(mediaId)).rejects.toThrow()
  })

  it('JSON でないレスポンスは内容を含めて throw する', async () => {
    fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 200 }))

    await expect(createApiClient(BASE_URL).mediaUrl(mediaId)).rejects.toThrow(
      /JSON ではありません/u,
    )
  })
})

/** 制作者 2026-10-09。**画面が API を呼ぶ場所に揃える**（LAN から開いたときも同じ口を指す）。 */
describe('takeDownloadUrl', () => {
  it('API の場所から、Shot と Take の口を指す', () => {
    const client = createApiClient('http://192.168.0.42:3001')
    expect(client.takeDownloadUrl({ id: TakeId.parse(TAKE_ID), shotId: ShotId.parse(SHOT_ID) })).toBe(
      `http://192.168.0.42:3001/shots/${SHOT_ID}/takes/${TAKE_ID}/download`,
    )
  })
})
