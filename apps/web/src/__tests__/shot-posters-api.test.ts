import { ProjectId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_ID, SHOT_ID, TAKE_ID } from '@/__tests__/fixtures'
import { createRequester } from '@/lib/requester'
import { createShotPostersApi, WireShotPoster } from '@/lib/shot-posters-api'

/**
 * サムネイルをまとめて取る口（P60-3）。
 *
 * ここで固定したいのは 1 つだけ。**絵が無いのに理由も無い行を通さない。**
 * 理由の無い空枠は「まだ作っていない」と「作ったが読めない」を同じ見た目にする（L-015）。
 */

const BASE_URL = 'http://127.0.0.1:3001'
const projectId = ProjectId.parse(PROJECT_ID)

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WireShotPoster のスキーマ', () => {
  it('絵がある行は reason が null', () => {
    const parsed = WireShotPoster.parse({
      shotId: SHOT_ID,
      takeId: TAKE_ID,
      thumbnailUrl: 'https://example.invalid/thumb.jpg?sig=x',
      reason: null,
    })

    expect(parsed.thumbnailUrl).toBe('https://example.invalid/thumb.jpg?sig=x')
    expect(parsed.reason).toBeNull()
  })

  it('絵が無い行は reason が入る', () => {
    const parsed = WireShotPoster.parse({
      shotId: SHOT_ID,
      takeId: null,
      thumbnailUrl: null,
      reason: 'no_take',
    })

    expect(parsed.reason).toBe('no_take')
  })

  it('両方 null は通さない（理由の無い空枠を作らない）', () => {
    expect(() =>
      WireShotPoster.parse({
        shotId: SHOT_ID,
        takeId: null,
        thumbnailUrl: null,
        reason: null,
      }),
    ).toThrow()
  })

  it('両方が入っているのも通さない（どちらを信じるか決まらない）', () => {
    expect(() =>
      WireShotPoster.parse({
        shotId: SHOT_ID,
        takeId: TAKE_ID,
        thumbnailUrl: 'https://example.invalid/thumb.jpg?sig=x',
        reason: 'no_take',
      }),
    ).toThrow()
  })
})

describe('listShotPosters', () => {
  it('projectId で引き、封筒を剥がして返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          {
            shotId: SHOT_ID,
            takeId: TAKE_ID,
            thumbnailUrl: 'https://example.invalid/thumb.jpg?sig=x',
            reason: null,
          },
        ],
      }),
    )

    const api = createShotPostersApi(createRequester(BASE_URL))
    const list = await api.listShotPosters(projectId)

    expect(list).toHaveLength(1)
    expect(list[0]?.takeId).toBe(TAKE_ID)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/projects/${PROJECT_ID}/shot-posters`)
  })

  it('理由の無い空枠が混ざっていたら読み込み自体を失敗させる', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [{ shotId: SHOT_ID, takeId: null, thumbnailUrl: null, reason: null }],
      }),
    )

    const api = createShotPostersApi(createRequester(BASE_URL))

    await expect(api.listShotPosters(projectId)).rejects.toThrow()
  })
})
