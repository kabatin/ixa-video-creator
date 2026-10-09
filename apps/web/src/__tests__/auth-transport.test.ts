import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { sameHostAsPage } from '@/lib/api-client'
import { send } from '@/lib/http'
import { createRequester } from '@/lib/requester'

/**
 * 認証（2026-10-09）。画面から API へクッキーを届ける仕組み。
 * **どれか 1 つ欠けると、入ったのに全部 401 になる。**
 */
describe('API の場所はページと同じホストにする', () => {
  it('ホスト名だけ差し替え、ポートと http/https は設定のまま', () => {
    expect(sameHostAsPage('http://macbookpro.local:3001', 'localhost')).toBe('http://localhost:3001')
    expect(sameHostAsPage('https://api.example:8443/base', '192.168.0.42')).toBe('https://192.168.0.42:8443/base')
  })

  it('読めない設定はそのまま返す', () => {
    expect(sameHostAsPage('not a url', 'localhost')).toBe('not a url')
  })
})

describe('送り方', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const stubFetch = (status: number) => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response('{"success":true,"data":{}}', { status })),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('クッキーを付けて送る（画面と API はポートが違う）', async () => {
    const fetchMock = stubFetch(200)
    await send('http://localhost:3001/projects', { method: 'GET' })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' })
  })

  it('401 なら入り口へ送る（いた場所を next に持たせる）', async () => {
    stubFetch(401)
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { pathname: '/projects/01ABC', search: '?view=t', assign } })
    await send('http://localhost:3001/projects', { method: 'GET' })
    expect(assign).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/projects/01ABC?view=t')}`)
  })

  it('入る口への 401（合言葉のまちがい）では送らない', async () => {
    stubFetch(401)
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { pathname: '/login', search: '', assign } })
    await send('http://localhost:3001/auth/login', { method: 'POST' })
    expect(assign).not.toHaveBeenCalled()
  })

  it('Next のサーバ側から呼ぶときは、渡されたクッキーを付ける', async () => {
    const fetchMock = stubFetch(200)
    await createRequester('http://localhost:3001', { cookie: 'ixa_session=abc' }).get('/projects', z.object({}))
    const headers = fetchMock.mock.calls[0]?.[1].headers as Record<string, string>
    expect(headers.cookie).toBe('ixa_session=abc')
  })
})
