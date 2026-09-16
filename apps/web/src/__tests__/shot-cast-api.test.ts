import { CharacterId, CharacterLookId, ShotId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHARACTER_ID, LOOK_ID, SHOT_ID } from '@/__tests__/fixtures'
import { createRequester } from '@/lib/requester'
import { createShotCastApi } from '@/lib/shot-cast-api'

const BASE_URL = 'http://127.0.0.1:3001'
const CAST_PATH = `${BASE_URL}/shots/${SHOT_ID}/characters`

const shotId = ShotId.parse(SHOT_ID)
const characterId = CharacterId.parse(CHARACTER_ID)
const lookId = CharacterLookId.parse(LOOK_ID)

const castJson = {
  shotId: SHOT_ID,
  characterId: CHARACTER_ID,
  lookId: LOOK_ID,
  prominence: 'primary',
  order: 0,
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const requestBodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined

const fetchMock = vi.fn<typeof fetch>()

const api = () => createShotCastApi(createRequester(BASE_URL))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shot cast API', () => {
  it('listShotCast は封筒を剥がしてドメインのスキーマで検証する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [castJson] }))

    const cast = await api().listShotCast(shotId)

    expect(cast).toEqual([castJson])
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(CAST_PATH)
    expect(init?.method).toBe('GET')
  })

  it('listShotCast は空配列をそのまま返す（誰も出ていないことは失敗ではない）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))

    await expect(api().listShotCast(shotId)).resolves.toEqual([])
  })

  it('replaceShotCast は PUT で entries を包んで送り、shotId を本文に入れない', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [castJson] }))

    const saved = await api().replaceShotCast(shotId, [
      { characterId, lookId, prominence: 'primary', order: 0 },
    ])

    expect(saved).toEqual([castJson])
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(CAST_PATH)
    expect(init?.method).toBe('PUT')
    expect(requestBodyOf(init)).toEqual({
      entries: [{ characterId: CHARACTER_ID, lookId: LOOK_ID, prominence: 'primary', order: 0 }],
    })
  })

  it('replaceShotCast は lookId の無い entry を送る前に弾く', async () => {
    await expect(
      api().replaceShotCast(shotId, [
        // lookId は必須（DOMAIN.md §5）。型を外して「送ってしまう」経路を塞げているか確かめる。
        { characterId, prominence: 'primary', order: 0 } as never,
      ]),
    ).rejects.toThrow()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('replaceShotCast は 422 を握り潰さず、本文を添えて投げる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: '指定された Look が存在しません' }, 422),
    )

    await expect(
      api().replaceShotCast(shotId, [
        { characterId, lookId, prominence: 'primary', order: 0 },
      ]),
    ).rejects.toThrow(/422/u)
  })

  it('unlinkShotCharacter は該当 1 件だけを DELETE する', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await api().unlinkShotCharacter(shotId, characterId)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${CAST_PATH}/${CHARACTER_ID}`)
    expect(init?.method).toBe('DELETE')
  })

  it('unlinkShotCharacter は失敗を成功に見せない', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'not found' }, 404))

    await expect(api().unlinkShotCharacter(shotId, characterId)).rejects.toThrow(/404/u)
  })
})
