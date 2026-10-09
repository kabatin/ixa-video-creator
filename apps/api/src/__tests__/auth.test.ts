import { OpenAPIHono } from '@hono/zod-openapi'
import { describe, expect, it } from 'vitest'
import { FOREIGN_ORIGIN_MESSAGE, SESSION_COOKIE, createAuthGate } from '../auth/gate.js'
import { LOGIN_MAX_FAILURES, createLoginLimiter } from '../auth/login-limiter.js'
import { hashToken } from '../auth/token.js'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { TOKENS_NEED_BROWSER_MESSAGE, authRoutes } from '../routes/auth.js'
import { createInMemoryAccessTokens } from './in-memory-access-token-repository.js'

/**
 * 認証（制作者 2026-10-09「3 はまず認証の仕組みを追加しましょうか」）。
 * **門を外したら落ちる**ことを、守られた口（`/projects`）で確かめる。
 */
const PASSPHRASE = 'correct horse battery staple'
const ORIGIN = 'http://192.168.0.42:3000'

const build = (options: { now?: () => Date } = {}) => {
  const tokens = createInMemoryAccessTokens()
  const now = options.now ?? (() => new Date())
  const logger = createLogger('silent')
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, logger)
  app.use('*', createAuthGate({ tokens, allowedOrigins: [ORIGIN], now, logger }))
  app.get('/health', (c) => c.json({ ok: true }))
  app.get('/files/media/x.mp4', (c) => c.text('signed'))
  app.get('/projects', (c) => c.json({ ok: true }))
  app.post('/projects', (c) => c.json({ ok: true }))
  app.route(
    '/',
    authRoutes({
      passphrase: PASSPHRASE,
      tokens,
      limiter: createLoginLimiter(),
      now,
      logger,
      clientKeyOf: () => 'test-client',
    }),
  )
  return { app, tokens }
}

const login = (app: OpenAPIHono, passphrase = PASSPHRASE) =>
  app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  })

const cookieOf = (res: Response): string => {
  const raw = res.headers.get('set-cookie') ?? ''
  return raw.split(';')[0] ?? ''
}

const loggedIn = async () => {
  const built = build()
  const res = await login(built.app)
  return { ...built, cookie: cookieOf(res), res }
}

describe('門', () => {
  it('鍵が無ければ 401', async () => {
    expect((await build().app.request('/projects')).status).toBe(401)
  })

  it('起動の確認・署名付きの素材・入る口は、鍵なしで通る', async () => {
    const { app } = build()
    expect((await app.request('/health')).status).toBe(200)
    expect((await app.request('/files/media/x.mp4')).status).toBe(200)
    expect((await login(app, 'wrong passphrase!')).status).toBe(401) // 門ではなく合言葉で断られる
  })

  it('知らない鍵は 401', async () => {
    const res = await build().app.request('/projects', { headers: { Cookie: `${SESSION_COOKIE}=nope` } })
    expect(res.status).toBe(401)
  })
})

describe('合言葉で入る', () => {
  it('合言葉が合えばクッキーを渡し、それで守られた口に入れる', async () => {
    const { app, cookie, res } = await loggedIn()

    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect((await app.request('/projects', { headers: { Cookie: cookie } })).status).toBe(200)
  })

  it('鍵そのものは表に入らない（ハッシュだけ）', async () => {
    const { tokens, cookie } = await loggedIn()
    const token = cookie.split('=')[1] ?? ''

    expect(token.length).toBeGreaterThan(20)
    expect(JSON.stringify(tokens.rows())).not.toContain(token)
    expect(tokens.rows()[0]?.tokenHash).toBe(hashToken(token))
  })

  it('合言葉が違えば 401 で、クッキーを渡さない', async () => {
    const res = await login(build().app, 'wrong passphrase!')
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it(`${String(LOGIN_MAX_FAILURES)} 回まちがえたら、合っていても 429（待つ秒数付き）`, async () => {
    const { app } = build()
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) await login(app, 'wrong passphrase!')

    const res = await login(app)
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('出ると、その鍵は使えなくなる', async () => {
    const { app, cookie } = await loggedIn()
    await app.request('/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })
    expect((await app.request('/projects', { headers: { Cookie: cookie } })).status).toBe(401)
  })

  it('期限（30 日）を過ぎた鍵は使えない', async () => {
    let now = new Date('2026-10-09T00:00:00Z')
    const { app } = build({ now: () => now })
    const cookie = cookieOf(await login(app))
    now = new Date('2026-11-09T00:00:00Z')
    expect((await app.request('/projects', { headers: { Cookie: cookie } })).status).toBe(401)
  })
})

describe('よそのページからの書き込み', () => {
  it('クッキーで来た書き込みは、許可したオリジンからだけ通す', async () => {
    const { app, cookie } = await loggedIn()
    const post = (origin?: string) =>
      app.request('/projects', {
        method: 'POST',
        headers: { Cookie: cookie, ...(origin === undefined ? {} : { Origin: origin }) },
      })

    expect((await post(ORIGIN)).status).toBe(200)
    const foreign = await post('http://evil.example')
    expect(foreign.status).toBe(403)
    expect(await foreign.text()).toContain(FOREIGN_ORIGIN_MESSAGE)
    expect((await post()).status).toBe(403)
  })

  it('クッキーで来た読み取りはオリジンを見ない', async () => {
    const { app, cookie } = await loggedIn()
    expect((await app.request('/projects', { headers: { Cookie: cookie } })).status).toBe(200)
  })
})

describe('自動化用の鍵（MCP 向け）', () => {
  const issue = async () => {
    const { app, cookie, tokens } = await loggedIn()
    const res = await app.request('/auth/tokens', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Claude の MCP' }),
    })
    const json = (await res.json()) as { data: { token: string; accessToken: { id: string } } }
    return { app, cookie, tokens, res, token: json.data.token, id: json.data.accessToken.id }
  }

  it('画面から発行でき、鍵はその応答でだけ返る。Bearer で入れて、オリジンは見ない', async () => {
    const { app, cookie, res, token } = await issue()
    expect(res.status).toBe(201)

    const list = await app.request('/auth/tokens', { headers: { Cookie: cookie } })
    expect(await list.text()).not.toContain(token)

    const auth = { Authorization: `Bearer ${token}` }
    expect((await app.request('/projects', { headers: auth })).status).toBe(200)
    expect((await app.request('/projects', { method: 'POST', headers: auth })).status).toBe(200)
  })

  it('自動化用の鍵で、鍵の発行・一覧・取り消しはできない（人が画面からだけ）', async () => {
    const { app, token } = await issue()
    const res = await app.request('/auth/tokens', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'もう 1 本' }),
    })
    expect(res.status).toBe(403)
    expect(await res.text()).toContain(TOKENS_NEED_BROWSER_MESSAGE)
  })

  it('取り消すと、その鍵は使えなくなる', async () => {
    const { app, cookie, token, id } = await issue()
    const revoked = await app.request(`/auth/tokens/${id}`, { method: 'DELETE', headers: { Cookie: cookie, Origin: ORIGIN } })
    expect(revoked.status).toBe(200)
    expect((await app.request('/projects', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401)
  })

  it('端末の鍵を Bearer で、自動化の鍵をクッキーで見せても入れない（取り違えを通さない）', async () => {
    const { app, cookie, token } = await issue()
    const browserToken = cookie.split('=')[1] ?? ''
    expect((await app.request('/projects', { headers: { Authorization: `Bearer ${browserToken}` } })).status).toBe(401)
    expect((await app.request('/projects', { headers: { Cookie: `${SESSION_COOKIE}=${token}` } })).status).toBe(401)
  })
})
