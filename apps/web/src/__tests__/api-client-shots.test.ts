import { ProjectId, ShotId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@/lib/api-client'
import { ApiError } from '@/lib/api-error'
import { PROJECT_ID, SHOT_ID, shotJson } from './fixtures'

const BASE_URL = 'http://127.0.0.1:3001'

const projectId = ProjectId.parse(PROJECT_ID)
const shotId = ShotId.parse(SHOT_ID)

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

describe('listShots', () => {
  it('封筒を剥がして Shot をパースする', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [shotJson], meta: { total: 1 } }),
    )

    const shots = await createApiClient(BASE_URL).listShots(projectId)

    expect(shots).toHaveLength(1)
    expect(shots[0]?.code).toBe('S01-010')
    expect(shots[0]?.camera.size).toBe('medium')
    expect(shots[0]?.createdAt).toBeInstanceOf(Date)

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/shots`)
  })

  it('HTTP エラーはステータスと本文を含めて throw する', async () => {
    fetchMock.mockResolvedValue(new Response('database is on fire', { status: 500 }))

    const error = await createApiClient(BASE_URL)
      .listShots(projectId)
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(500)
    // 理由は body に残す。message には入れない（画面へ出る経路から参照されるため）。
    expect((error as ApiError).body).toContain('database is on fire')
  })

  it('不正な形の Shot は zod が throw する', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...shotJson, durationSec: 0 }] }),
    )

    await expect(createApiClient(BASE_URL).listShots(projectId)).rejects.toThrow()
  })

  it('fetch 自体が失敗したら transport エラーになる', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const error = await createApiClient(BASE_URL)
      .listShots(projectId)
      .catch((cause: unknown) => cause)

    expect((error as ApiError).isTransportError).toBe(true)
  })
})

describe('createShot / updateShot / deleteShot', () => {
  it('createShot は projectId をパスに載せて POST する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: shotJson }, 201))

    const created = await createApiClient(BASE_URL).createShot(projectId, {
      sequenceId: null,
      order: 1000,
      code: 'S01-010',
      startSec: 0,
      durationSec: 4,
      description: '夜のスタジアム',
      dialogue: null,
      camera: shotJson.camera,
      mood: 'tense',
      sourceType: { type: 'ai_video' },
      continuityMode: 'independent',
    })

    expect(created.id).toBe(SHOT_ID)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/shots`)
    expect(init?.method).toBe('POST')
    expect(requestBodyOf(init)).toMatchObject({ code: 'S01-010', sourceInSec: 0, status: 'draft' })
  })

  it('createShot は送信前に入力を検証する', async () => {
    await expect(
      createApiClient(BASE_URL).createShot(projectId, {
        sequenceId: null,
        order: 1000,
        code: '',
        startSec: 0,
        durationSec: 4,
        description: '',
        dialogue: null,
        camera: shotJson.camera,
        mood: null,
        sourceType: { type: 'ai_video' },
        continuityMode: 'independent',
      }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('updateShot は PATCH で部分更新する', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...shotJson, durationSec: 6 } }),
    )

    const updated = await createApiClient(BASE_URL).updateShot(shotId, { durationSec: 6 })

    expect(updated.durationSec).toBe(6)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/shots/${SHOT_ID}`)
    expect(init?.method).toBe('PATCH')
    expect(requestBodyOf(init)).toEqual({ durationSec: 6 })
  })

  it('deleteShot は 204 を成功として扱う', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(createApiClient(BASE_URL).deleteShot(shotId)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE')
  })

  it('deleteShot の 404 は throw する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'not found' }, 404))

    await expect(createApiClient(BASE_URL).deleteShot(shotId)).rejects.toBeInstanceOf(ApiError)
  })
})

describe('getShot', () => {
  it('Shot を 1 件取得してパースする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: shotJson }))

    const shot = await createApiClient(BASE_URL).getShot(shotId)

    expect(shot.code).toBe('S01-010')
    expect(shot.createdAt).toBeInstanceOf(Date)

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/shots/${SHOT_ID}`)
  })

  it('HTTP エラーを握り潰さない', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: 'リソースが見つかりません' }, 404),
    )
    await expect(createApiClient(BASE_URL).getShot(shotId)).rejects.toThrow()
  })
})
