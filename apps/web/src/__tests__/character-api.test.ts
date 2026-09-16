import { CharacterId, CharacterIdentityImageId, MediaAssetId, WorkspaceId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@/lib/api-client'
import {
  CHARACTER_ID,
  IDENTITY_IMAGE_ID,
  MEDIA_ID,
  WORKSPACE_ID,
  characterJson,
  identityImageJson,
} from '@/__tests__/fixtures'

const BASE_URL = 'http://127.0.0.1:3001'

const characterId = CharacterId.parse(CHARACTER_ID)
const identityImageId = CharacterIdentityImageId.parse(IDENTITY_IMAGE_ID)
const workspaceId = WorkspaceId.parse(WORKSPACE_ID)

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

describe('character API', () => {
  it('listCharacters は workspaceId で絞り、封筒を剥がしてパースする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [characterJson] }))

    const characters = await createApiClient(BASE_URL).listCharacters(workspaceId)

    expect(characters).toHaveLength(1)
    expect(characters[0]?.identityAnchors).toEqual(['20代日本人男性', '細身'])
    expect(characters[0]?.createdAt).toBeInstanceOf(Date)

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/characters?workspaceId=${WORKSPACE_ID}`)
  })

  it('createCharacter は既定値を埋めた本文を POST する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: characterJson }, 201))

    const created = await createApiClient(BASE_URL).createCharacter({
      workspaceId,
      name: 'takepi',
      displayName: 'タケピ',
    })

    expect(created.id).toBe(CHARACTER_ID)
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.method).toBe('POST')
    expect(JSON.parse(requestBodyOf(init)) as unknown).toMatchObject({
      name: 'takepi',
      description: '',
      identityAnchors: [],
      styleTokens: [],
      colorPalette: [],
    })
  })

  it('getCharacter は 404 を null にする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'not found' }, 404))

    await expect(createApiClient(BASE_URL).getCharacter(characterId)).resolves.toBeNull()
  })

  it('updateCharacter は PATCH で部分更新する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: characterJson }))

    await createApiClient(BASE_URL).updateCharacter(characterId, { displayName: 'タケピ' })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/characters/${CHARACTER_ID}`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(requestBodyOf(init)) as unknown).toEqual({ displayName: 'タケピ' })
  })

  it('addIdentityImage は role と order を載せて POST する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: identityImageJson }, 201))

    const created = await createApiClient(BASE_URL).addIdentityImage(characterId, {
      mediaAssetId: MediaAssetId.parse(MEDIA_ID),
      role: 'four_view',
      isPrimary: true,
      order: 0,
    })

    expect(created.role).toBe('four_view')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/characters/${CHARACTER_ID}/identity-images`)
    expect(JSON.parse(requestBodyOf(init)) as unknown).toMatchObject({ role: 'four_view', order: 0 })
  })

  it('setPrimaryIdentityImage は本文なしで POST する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: identityImageJson }))

    await createApiClient(BASE_URL).setPrimaryIdentityImage(identityImageId)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/identity-images/${IDENTITY_IMAGE_ID}/primary`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  it('role が未知の識別画像はレスポンス検証で throw する', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...identityImageJson, role: 'back_view' }] }),
    )

    await expect(createApiClient(BASE_URL).listIdentityImages(characterId)).rejects.toThrow()
  })
})
