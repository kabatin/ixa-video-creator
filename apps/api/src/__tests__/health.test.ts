import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createLogger } from '../logger.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

const buildApp = () =>
  createApp({ projects: createInMemoryProjectRepository(), logger: createLogger('silent') })

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
