import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { getConnInfo } from '@hono/node-server/conninfo'
import { DbNotFoundError, type AccessTokenRepository } from '@ixa/db'
import {
  AccessTokenId as AccessTokenIdSchema,
  AccessTokenKind as AccessTokenKindSchema,
  BROWSER_SESSION_DAYS,
  type AccessToken,
} from '@ixa/domain'
import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import type { Logger } from 'pino'
import {
  SESSION_COOKIE,
  UNAUTHENTICATED_MESSAGE,
  presentedToken,
  resolveAccessToken,
} from '../auth/gate.js'
import type { LoginLimiter } from '../auth/login-limiter.js'
import { hashToken, issueToken, passphraseMatches } from '../auth/token.js'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 入る・出る・鍵の管理（認証。制作者 2026-10-09「3 はまず認証の仕組みを追加しましょうか」）。
 *
 * `POST /auth/login` だけが門の外。ほかは門を通ったあとに届く。
 */

export const WRONG_PASSPHRASE_MESSAGE = '合言葉が違います'
export const TOO_MANY_ATTEMPTS_MESSAGE = '続けてまちがえたので、しばらく待ってからもう一度入れてください'
export const TOKENS_NEED_BROWSER_MESSAGE = 'アクセス用の鍵の発行と取り消しは、画面からだけできます'

export type AuthRoutesDeps = {
  readonly passphrase: string
  readonly tokens: AccessTokenRepository
  readonly limiter: LoginLimiter
  readonly now: () => Date
  readonly logger: Logger
  /** まちがいを数える相手。既定は接続元の IP（テストでは接続が無いので差し替える）。 */
  readonly clientKeyOf?: (c: Context) => string
}

const DAY_MS = 24 * 60 * 60 * 1000

const clientKeyFromConnection = (c: Context): string => {
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 画面に出す形。**鍵そのものもハッシュも入れない。** */
const AccessTokenResponse = z
  .object({
    id: AccessTokenIdSchema,
    kind: AccessTokenKindSchema,
    label: z.string(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    lastUsedAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
  })
  .openapi('AccessToken')

const toResponse = (token: AccessToken): z.infer<typeof AccessTokenResponse> => ({
  id: token.id,
  kind: token.kind,
  label: token.label,
  createdAt: token.createdAt.toISOString(),
  expiresAt: token.expiresAt?.toISOString() ?? null,
  lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
  revokedAt: token.revokedAt?.toISOString() ?? null,
})

const loginRoute = createRoute({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  summary: '合言葉で入る（その端末にクッキーを渡す）',
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ passphrase: z.string().min(1).max(200) }) } },
    },
  },
  responses: {
    200: { description: '入った', content: { 'application/json': { schema: successResponse(AccessTokenResponse) } } },
    401: errorContent('合言葉が違う'),
    429: errorContent('続けてまちがえた（Retry-After 秒だけ待つ）'),
  },
})

const logoutRoute = createRoute({
  method: 'post',
  path: '/auth/logout',
  tags: ['auth'],
  summary: 'この端末の鍵を取り消して出る',
  responses: {
    200: { description: '出た', content: { 'application/json': { schema: successResponse(z.object({})) } } },
  },
})

const meRoute = createRoute({
  method: 'get',
  path: '/auth/me',
  tags: ['auth'],
  summary: 'いま使っている鍵',
  responses: {
    200: { description: '使っている鍵', content: { 'application/json': { schema: successResponse(AccessTokenResponse) } } },
    401: errorContent('入っていない'),
  },
})

const listTokensRoute = createRoute({
  method: 'get',
  path: '/auth/tokens',
  tags: ['auth'],
  summary: '自動化用の鍵の一覧（取り消したものも）',
  responses: {
    200: {
      description: '一覧',
      content: { 'application/json': { schema: successResponse(z.array(AccessTokenResponse)) } },
    },
    403: errorContent('画面以外から'),
  },
})

const IssuedToken = z
  .object({
    accessToken: AccessTokenResponse,
    /** **ここでしか返さない。** 表にはハッシュしか無いので、あとから見る方法は無い。 */
    token: z.string(),
  })
  .openapi('IssuedAccessToken')

const issueTokenRoute = createRoute({
  method: 'post',
  path: '/auth/tokens',
  tags: ['auth'],
  summary: '自動化用の鍵を発行する（鍵はこの応答でだけ見られる）',
  request: {
    body: { content: { 'application/json': { schema: z.object({ label: z.string().trim().min(1).max(80) }) } } },
  },
  responses: {
    201: { description: '発行した', content: { 'application/json': { schema: successResponse(IssuedToken) } } },
    403: errorContent('画面以外から'),
  },
})

const revokeTokenRoute = createRoute({
  method: 'delete',
  path: '/auth/tokens/{id}',
  tags: ['auth'],
  summary: '自動化用の鍵を取り消す',
  request: { params: z.object({ id: AccessTokenIdSchema.openapi({ param: { name: 'id', in: 'path' } }) }) },
  responses: {
    200: { description: '取り消した', content: { 'application/json': { schema: successResponse(AccessTokenResponse) } } },
    403: errorContent('画面以外から'),
    404: errorContent('無い・自動化用ではない'),
  },
})

const browserLabel = (now: Date): string => `ブラウザ（${now.toISOString().slice(0, 10)} に入った）`

export const authRoutes = (deps: AuthRoutesDeps) => {
  const clientKeyOf = deps.clientKeyOf ?? clientKeyFromConnection
  /** 鍵の管理は**人が画面から**だけ。自動化用の鍵で新しい鍵を作らせない。 */
  const viaBrowser = (c: Context): boolean => presentedToken(c)?.via === 'cookie'

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(loginRoute, async (c) => {
      const key = clientKeyOf(c)
      const nowMs = deps.now().getTime()
      const waitMs = deps.limiter.blockedForMs(key, nowMs)
      if (waitMs !== null) {
        c.header('Retry-After', String(Math.ceil(waitMs / 1000)))
        return c.json(fail(TOO_MANY_ATTEMPTS_MESSAGE), 429)
      }
      if (!passphraseMatches(c.req.valid('json').passphrase, deps.passphrase)) {
        deps.limiter.recordFailure(key, nowMs)
        // 入れた文字はログに出さない。
        deps.logger.warn({ client: key }, '合言葉がまちがっていました')
        return c.json(fail(WRONG_PASSPHRASE_MESSAGE), 401)
      }
      deps.limiter.reset(key)

      const now = deps.now()
      const token = issueToken()
      const saved = await deps.tokens.create({
        kind: 'browser',
        label: browserLabel(now),
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + BROWSER_SESSION_DAYS * DAY_MS),
      })
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: BROWSER_SESSION_DAYS * 24 * 60 * 60,
      })
      return c.json(ok(toResponse(saved)), 200)
    })
    .openapi(logoutRoute, async (c) => {
      const presented = presentedToken(c)
      const token = presented === null ? null : await resolveAccessToken(deps, presented)
      if (token !== null) await deps.tokens.revoke(token.id, deps.now())
      deleteCookie(c, SESSION_COOKIE, { path: '/' })
      return c.json(ok({}), 200)
    })
    .openapi(meRoute, async (c) => {
      const presented = presentedToken(c)
      const token = presented === null ? null : await resolveAccessToken(deps, presented)
      if (token === null) return c.json(fail(UNAUTHENTICATED_MESSAGE), 401)
      return c.json(ok(toResponse(token)), 200)
    })
    .openapi(listTokensRoute, async (c) => {
      if (!viaBrowser(c)) return c.json(fail(TOKENS_NEED_BROWSER_MESSAGE), 403)
      return c.json(ok((await deps.tokens.listAutomation()).map(toResponse)), 200)
    })
    .openapi(issueTokenRoute, async (c) => {
      if (!viaBrowser(c)) return c.json(fail(TOKENS_NEED_BROWSER_MESSAGE), 403)
      const token = issueToken()
      const saved = await deps.tokens.create({
        kind: 'automation',
        label: c.req.valid('json').label,
        tokenHash: hashToken(token),
        expiresAt: null,
      })
      return c.json(ok({ accessToken: toResponse(saved), token }), 201)
    })
    .openapi(revokeTokenRoute, async (c) => {
      if (!viaBrowser(c)) return c.json(fail(TOKENS_NEED_BROWSER_MESSAGE), 403)
      const { id } = c.req.valid('param')
      const listed = (await deps.tokens.listAutomation()).find((token) => token.id === id)
      if (listed === undefined) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      try {
        return c.json(ok(toResponse(await deps.tokens.revoke(id, deps.now()))), 200)
      } catch (error) {
        if (error instanceof DbNotFoundError) return c.json(fail(NOT_FOUND_MESSAGE), 404)
        throw error
      }
    })
}
