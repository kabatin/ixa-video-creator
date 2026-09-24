import { CharacterId, CharacterLookId, MediaAssetId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@/lib/api-client'
import { ApiError } from '@/lib/api-error'
import {
  CANONICAL_FRAME_ID,
  CHARACTER_ID,
  LOOK_ID,
  lookImageJson,
  lookJson,
} from '@/__tests__/fixtures'

const BASE_URL = 'http://127.0.0.1:3001'

const characterId = CharacterId.parse(CHARACTER_ID)
const lookId = CharacterLookId.parse(LOOK_ID)

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

describe('look API', () => {
  it('createLook は era と canonicalFrameAssetId の既定を埋める', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: lookJson }, 201))

    await createApiClient(BASE_URL).createLook(characterId, {
      key: 'IXA_CUP_PAST',
      name: 'iXA CUP 2019',
    })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(requestBodyOf(init)) as unknown).toMatchObject({
      key: 'IXA_CUP_PAST',
      era: null,
      canonicalFrameAssetId: null,
      isDefault: false,
    })
  })

  it('key の形が不正な Look は送信前に弾く', async () => {
    await expect(
      createApiClient(BASE_URL).createLook(characterId, { key: 'ixa cup', name: 'x' }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('setCanonicalFrame は mediaAssetId を本文に載せる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { ...lookJson, canonicalFrameAssetId: CANONICAL_FRAME_ID },
      }),
    )

    const updated = await createApiClient(BASE_URL).setCanonicalFrame(
      lookId,
      MediaAssetId.parse(CANONICAL_FRAME_ID),
    )

    expect(updated.canonicalFrameAssetId).toBe(CANONICAL_FRAME_ID)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/looks/${LOOK_ID}/canonical-frame`)
    expect(JSON.parse(requestBodyOf(init)) as unknown).toEqual({
      mediaAssetId: CANONICAL_FRAME_ID,
    })
  })

  it('listLookImages は order 昇順の一覧をパースする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [lookImageJson] }))

    const images = await createApiClient(BASE_URL).listLookImages(lookId)

    expect(images[0]?.role).toBe('wardrobe')
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/looks/${LOOK_ID}/images`)
  })

  it('deleteLook は 204 を本文なしで受け取る', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(createApiClient(BASE_URL).deleteLook(lookId)).resolves.toBeUndefined()

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.method).toBe('DELETE')
  })

  it('最後の Look を削除しようとした 422 はステータスと本文を含めて throw する', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: '既定 Look は削除できません' }, 422),
    )

    const error = await createApiClient(BASE_URL)
      .deleteLook(lookId)
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(422)
    // 理由は body に残す。message には入れない（画面へ出る経路から参照されるため）。
    expect((error as ApiError).body).toContain('既定 Look は削除できません')
  })
})
