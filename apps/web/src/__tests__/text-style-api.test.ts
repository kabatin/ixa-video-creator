import { ProjectId, TextStyleId, TimelineClipId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@/lib/api-client'

/** テロップのスタイルの API（ADR-0028）。 */
const BASE_URL = 'http://127.0.0.1:3001'
const PROJECT = ProjectId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW')
const STYLE = TextStyleId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')
const CLIP = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB0')

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fetchMock = vi.fn<typeof fetch>()
const urlOf = (input: Parameters<typeof fetch>[0] | undefined): string =>
  input === undefined ? '' : typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
const bodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const presetJson = {
  id: STYLE,
  projectId: PROJECT,
  name: '歌詞',
  style: { color: '#FFD100' },
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
}

describe('text-style-api', () => {
  it('保存する（名前と見た目を送る）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: presetJson }, 201))

    const created = await createApiClient(BASE_URL).createTextStyle(PROJECT, { name: '歌詞', style: { color: '#FFD100' } })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(urlOf(url)).toBe(`${BASE_URL}/projects/${PROJECT}/text-styles`)
    expect(bodyOf(init)).toEqual({ name: '歌詞', style: { color: '#FFD100' } })
    expect(created.name).toBe('歌詞')
  })

  it('まとめて当てる（テロップと見た目とスタイルを送る）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [], meta: { total: 0 } }))

    await createApiClient(BASE_URL).applyTextStyle(PROJECT, { clipIds: [CLIP], style: { size: 0.05 }, styleId: STYLE })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(urlOf(url)).toBe(`${BASE_URL}/projects/${PROJECT}/clips/text-style`)
    expect(bodyOf(init)).toEqual({ clipIds: [CLIP], style: { size: 0.05 }, styleId: STYLE })
  })

  it('読めない見た目は送る前に弾く', async () => {
    await expect(
      createApiClient(BASE_URL).applyTextStyle(PROJECT, { clipIds: [CLIP], style: { color: 'red' }, styleId: null }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
