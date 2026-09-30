import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createLogger } from '../logger.js'
import { createMemoryStorage } from '@ixa/storage'
import { createInMemoryMediaAssetRepository } from '@ixa/generation/testing'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { baseAppDeps } from './app-deps.js'

const buildApp = () =>
  createApp({
    ...baseAppDeps(),
    projects: createInMemoryProjectRepository(),
    mediaAssets: createInMemoryMediaAssetRepository(),
    storage: createMemoryStorage(),
    logger: createLogger('silent'),
  })

describe('GET /health', () => {
  it('200 と { success: true, data: { status, uptimeSec } } を返す', async () => {
    const res = await buildApp().request('/health')

    expect(res.status).toBe(200)

    const body: unknown = await res.json()
    expect(body).toMatchObject({ success: true, data: { status: 'ok' } })

    const parsed = body as { data: { uptimeSec: number } }
    expect(typeof parsed.data.uptimeSec).toBe('number')
    expect(parsed.data.uptimeSec).toBeGreaterThanOrEqual(0)
  })
})

describe('未定義のルート', () => {
  it('404 と統一されたエラー形式を返す', async () => {
    const res = await buildApp().request('/does-not-exist')

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ success: false })
  })
})

describe('GET /openapi.json', () => {
  it('OpenAPI ドキュメントを配信する', async () => {
    const res = await buildApp().request('/openapi.json')

    expect(res.status).toBe(200)

    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> }
    expect(doc.openapi).toBe('3.0.0')
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/health', '/projects', '/projects/{id}']),
    )
  })
})

describe('CORS', () => {
  it('許可したオリジンからのプリフライトを通す', async () => {
    const app = createApp({ ...baseAppDeps(), corsOrigins: ['http://127.0.0.1:3000'] })
    const res = await app.request('/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:3000',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:3000')
  })

  /**
   * 画面の Requester が使うメソッドはすべて通す。PUT を許していなかったため、
   * 「使う AI」の保存と、最初のフレームを手で付ける操作がブラウザで止まっていた（2026-09-30）。
   */
  it.each(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])('画面が使う %s のプリフライトを通す', async (method) => {
    const app = createApp({ ...baseAppDeps(), corsOrigins: ['http://127.0.0.1:3000'] })
    const res = await app.request('/ai/settings', {
      method: 'OPTIONS',
      headers: { Origin: 'http://127.0.0.1:3000', 'Access-Control-Request-Method': method },
    })
    expect(res.headers.get('access-control-allow-methods')?.split(',')).toContain(method)
  })

  it('許可していないオリジンには許可ヘッダを返さない', async () => {
    const app = createApp({ ...baseAppDeps(), corsOrigins: ['http://127.0.0.1:3000'] })
    const res = await app.request('/health', {
      headers: { Origin: 'http://evil.example.com' },
    })
    expect(res.headers.get('access-control-allow-origin')).not.toBe('http://evil.example.com')
  })

  it('ワイルドカードを返さない（許可先を明示する設計）', async () => {
    const app = createApp({ ...baseAppDeps(), corsOrigins: ['http://127.0.0.1:3000'] })
    const res = await app.request('/health', {
      headers: { Origin: 'http://127.0.0.1:3000' },
    })
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*')
  })

  it('設定が空なら CORS を有効にしない', async () => {
    const app = createApp({ ...baseAppDeps(), corsOrigins: [] })
    const res = await app.request('/health', {
      headers: { Origin: 'http://127.0.0.1:3000' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
