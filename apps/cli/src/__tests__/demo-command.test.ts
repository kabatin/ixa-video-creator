import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../args.js'
import { demoCommand } from '../commands/demo.js'
import { paths } from '../lib/repo.js'
import type { Output } from '../printer.js'
import type { HttpResult, Listener } from '../system.js'
import { fakeSystem } from './fake-system.js'

/**
 * `pnpm ixa demo`（ADR-0067）。動いている ixa に見本の作品を入れてもらい、画面の場所を言う。
 * 合言葉を決めている人には入らない（合言葉を CLI に持たせない）。画面の「見本を開く」へ案内する。
 */

const repo = paths('/repo')
const WS = '01JWSWSWSWSWSWSWSWSWSWSWSW'
const ENV = `DATABASE_URL=postgresql://ixa:pw@127.0.0.1:5432/ixa\nNEXT_PUBLIC_WORKSPACE_ID=${WS}\nCORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000\n`
const API = 'http://127.0.0.1:3001'
const ROOT_PACKAGE = JSON.stringify({ name: 'ixa-video-creator', version: '0.8.4' })
/** この clone の ixa が 3 つのポートで動いている。 */
const RUNNING: Readonly<Record<number, Listener>> = {
  3000: { pid: 1, cwd: '/repo/apps/web' },
  3001: { pid: 2, cwd: '/repo/apps/api' },
  8100: { pid: 3, cwd: '/repo/apps/audio' },
}
const HEALTH = JSON.stringify({ success: true, data: { status: 'ok' } })
const PROJECT = { id: '01JPRPRPRPRPRPRPRPRPRPRPRP', name: '見本の作品' }

const okJson = (data: unknown, status = 200): HttpResult => ({ ok: true, status, body: JSON.stringify({ success: true, data }) })

type Call = { readonly method: 'GET' | 'POST'; readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body?: string }

const harness = (options: {
  readonly env?: string | null
  readonly listeners?: Readonly<Record<number, Listener>>
  readonly status?: HttpResult
  readonly install?: HttpResult
}) => {
  const calls: Call[] = []
  const lines: string[] = []
  const results: unknown[] = []
  const files: Record<string, string> = { [repo.rootPackage]: ROOT_PACKAGE, ...(options.env === null ? {} : { [repo.env]: options.env ?? ENV }) }
  const system = fakeSystem(
    {},
    {
      readText: (p) => Promise.resolve(files[p] ?? null),
      listener: (port) => Promise.resolve((options.listeners ?? RUNNING)[port] ?? null),
      httpGet: (url, _timeout, headers = {}) => {
        calls.push({ method: 'GET', url, headers })
        if (url.endsWith('/health')) return Promise.resolve({ ok: true, status: 200, body: url.includes(':8100') ? JSON.stringify({ status: 'ok' }) : HEALTH })
        return Promise.resolve(options.status ?? okJson({ available: true, title: '見本の作品', totalBytes: 30_000_000, project: null }))
      },
      httpPost: (url, body, _timeout, headers = {}) => {
        calls.push({ method: 'POST', url, headers, body })
        if (url.endsWith('/auth/login')) {
          return Promise.resolve({ ok: true, status: 200, body: '{}', setCookies: ['ixa_session=tok123; Path=/; HttpOnly; SameSite=Lax'] })
        }
        if (url.endsWith('/auth/logout')) return Promise.resolve({ ok: true, status: 200, body: '{}' })
        return Promise.resolve(options.install ?? okJson({ project: PROJECT, created: true }, 201))
      },
    },
  )
  const out = (json: boolean): Output => ({ json, line: (t) => lines.push(t), result: (p) => results.push(p) })
  return { system, calls, lines, results, out }
}

const run = (h: ReturnType<typeof harness>, json = false) => demoCommand(h.system, repo, h.out(json))

describe('demoCommand', () => {
  it('.env が無ければ setup を勧め、何も呼ばない', async () => {
    const h = harness({ env: null })
    expect(await run(h)).toBe(1)
    expect(h.lines.join('\n')).toContain('pnpm ixa setup')
    expect(h.calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  it('ixa が動いていなければ、先に pnpm ixa start と言う', async () => {
    const h = harness({ listeners: {} })
    expect(await run(h, true)).toBe(1)
    expect(h.results[0]).toMatchObject({ command: 'demo', ok: false })
    expect(JSON.stringify(h.results[0])).toContain('pnpm ixa start')
    expect(h.calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  it('合言葉を決めていれば入らず、画面の「見本を開く」へ案内する', async () => {
    const h = harness({ env: `${ENV}IXA_PASSPHRASE=correct-horse-battery\n` })
    expect(await run(h)).toBe(1)
    expect(h.lines.join('\n')).toContain('画面の『見本を開く』から入れてください')
    expect(h.calls.filter((c) => c.url.includes('/auth/login'))).toEqual([])
  })

  it('見本がまだ無ければそう言い、入れようとしない', async () => {
    const h = harness({ status: okJson({ available: false, title: null, totalBytes: null, project: null }) })
    expect(await run(h)).toBe(1)
    expect(h.lines.join('\n')).toContain('見本はまだ用意されていません')
    expect(h.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/projects/demo'))).toEqual([])
  })

  it('合言葉なしで入り、クッキーと Origin を付けて入れ、画面の場所を言う', async () => {
    const h = harness({})
    expect(await run(h)).toBe(0)
    const login = h.calls.find((c) => c.url === `${API}/auth/login`)
    expect(login?.body).toBe(JSON.stringify({ passphrase: '' }))
    const status = h.calls.find((c) => c.method === 'GET' && c.url.startsWith(`${API}/projects/demo`))
    expect(status?.url).toBe(`${API}/projects/demo?workspaceId=${WS}`)
    expect(status?.headers['cookie']).toBe('ixa_session=tok123')
    const install = h.calls.find((c) => c.method === 'POST' && c.url === `${API}/projects/demo`)
    expect(install?.headers).toMatchObject({ cookie: 'ixa_session=tok123', origin: 'http://localhost:3000', 'content-type': 'application/json' })
    expect(install?.body).toBe(JSON.stringify({ workspaceId: WS }))
    expect(h.lines.join('\n')).toContain('見本を入れました')
    expect(h.lines.join('\n')).toContain(`http://localhost:3000/projects/${PROJECT.id}`)
    // 使い終えた鍵は取り消す。
    expect(h.calls.some((c) => c.url === `${API}/auth/logout`)).toBe(true)
  })

  it('もう入っていれば「もう入っています」。--json は 1 つの答え（command・ok・url）', async () => {
    const h = harness({ install: okJson({ project: PROJECT, created: false }) })
    expect(await run(h, true)).toBe(0)
    expect(h.results).toEqual([
      { command: 'demo', ok: true, created: false, title: '見本の作品', url: `http://localhost:3000/projects/${PROJECT.id}` },
    ])
  })

  it('入れられなければ API の理由を言って 1 で返る', async () => {
    const reason = '見本のファイルを取りに行けませんでした。インターネットにつながっているか確かめて、もう一度試してください。'
    const h = harness({ install: { ok: true, status: 502, body: JSON.stringify({ success: false, error: reason }) } })
    expect(await run(h)).toBe(1)
    expect(h.lines.join('\n')).toContain(reason)
  })
})

describe('demo の引数', () => {
  it('demo と --json を読む。知らないオプション・余分な語は止める', () => {
    expect(parseCliArgs(['demo'])).toMatchObject({ command: 'demo', json: false })
    expect(parseCliArgs(['demo', '--json'])).toMatchObject({ command: 'demo', json: true })
    expect(() => parseCliArgs(['demo', '--install'])).toThrow()
    expect(() => parseCliArgs(['demo', 'now'])).toThrow('1 つだけ')
  })
})
