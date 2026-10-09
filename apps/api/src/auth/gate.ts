import type { AccessTokenRepository } from '@ixa/db'
import { accessTokenRejection, type AccessToken } from '@ixa/domain'
import { STORAGE_FILE_ROUTE_PREFIX } from '@ixa/storage'
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Logger } from 'pino'
import { fail } from '../response.js'
import { hashToken } from './token.js'

/**
 * API の門（認証）。合言葉で入った端末（クッキー）か、自動化用の鍵（Bearer）が無ければ通さない。
 *
 * **門の外に置くもの**（鍵なしで通す）:
 * - `GET /health`（起動の確認）
 * - `/files/*`（素材の再生・アップロード・書き出し。**署名付き URL そのものが鍵**で、Remotion も使う）
 * - `POST /auth/login`（入るための口）
 * - CORS の下見（OPTIONS。ブラウザはクッキーを付けずに送る）
 */

export const SESSION_COOKIE = 'ixa_session'

export const UNAUTHENTICATED_MESSAGE = '合言葉を入れてください'
export const FOREIGN_ORIGIN_MESSAGE = 'よそのページからの書き込みは受けません'

/** 鍵の見せ方。クッキーなら画面、Bearer なら自動化（MCP・curl）。 */
export type PresentedToken = { readonly token: string; readonly via: 'cookie' | 'bearer' }

const BEARER = /^Bearer\s+(\S+)$/i

/** 要求が見せている鍵。**Bearer を先に見る**（自動化はクッキーを持たない）。 */
export const presentedToken = (c: Context): PresentedToken | null => {
  const header = c.req.header('authorization')
  const bearer = header === undefined ? null : BEARER.exec(header)?.[1]
  if (bearer !== undefined && bearer !== null) return { token: bearer, via: 'bearer' }
  const cookie = getCookie(c, SESSION_COOKIE)
  return cookie === undefined || cookie === '' ? null : { token: cookie, via: 'cookie' }
}

export const isPublicRequest = (method: string, path: string): boolean =>
  method === 'OPTIONS' ||
  (method === 'GET' && path === '/health') ||
  path.startsWith(`${STORAGE_FILE_ROUTE_PREFIX}/`) ||
  (method === 'POST' && path === '/auth/login')

const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** 最後に使った日時を書き込む間隔。**要求のたびには書かない**（画面は数秒おきに問い合わせる）。 */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000

export type AuthGateDeps = {
  readonly tokens: Pick<AccessTokenRepository, 'findByHash' | 'touch'>
  /** クッキーで来た書き込みを受けるオリジン（`CORS_ORIGINS` と同じもの）。 */
  readonly allowedOrigins: readonly string[]
  readonly now: () => Date
  readonly logger: Logger
}

/** 見せられた鍵を表で引き、使えるものだけを返す。 */
export const resolveAccessToken = async (
  deps: Pick<AuthGateDeps, 'tokens' | 'now'>,
  presented: PresentedToken,
): Promise<AccessToken | null> => {
  const found = await deps.tokens.findByHash(hashToken(presented.token))
  if (found === null || accessTokenRejection(found, deps.now()) !== null) return null
  // 端末の鍵を Bearer で、自動化の鍵をクッキーで見せるのは取り違え。通さない。
  const expected = presented.via === 'cookie' ? 'browser' : 'automation'
  return found.kind === expected ? found : null
}

export const createAuthGate =
  (deps: AuthGateDeps): MiddlewareHandler =>
  async (c, next) => {
    if (isPublicRequest(c.req.method, c.req.path)) {
      await next()
      return
    }
    const presented = presentedToken(c)
    const token = presented === null ? null : await resolveAccessToken(deps, presented)
    if (presented === null || token === null) return c.json(fail(UNAUTHENTICATED_MESSAGE), 401)

    /**
     * **よそのページからの書き込みを断る。** クッキーはブラウザが勝手に付けるので、
     * 別のページの中から POST されてもクッキーは届く。`Origin` が許可先にあるときだけ通す。
     * Bearer は人が持たせた鍵なので、この心配が無い。
     */
    if (presented.via === 'cookie' && WRITE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin')
      if (origin === undefined || !deps.allowedOrigins.includes(origin)) {
        return c.json(fail(FOREIGN_ORIGIN_MESSAGE), 403)
      }
    }

    const now = deps.now()
    if (token.lastUsedAt === null || now.getTime() - token.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS) {
      // 書けなくても要求は止めない（入れたかどうかとは関係が無い）。握り潰さずに残す。
      await deps.tokens.touch(token.id, now).catch((error: unknown) => {
        deps.logger.warn({ accessTokenId: token.id, err: error }, '鍵を最後に使った日時を書けませんでした')
      })
    }
    await next()
    return
  }
