import { OpenAPIHono } from '@hono/zod-openapi'
import { isLoopbackHost } from '@ixa/config'
import type { AccessTokenRepository } from '@ixa/db'
import type { Logger } from 'pino'
import type { AppAuth } from '../app.js'
import { authRoutes } from '../routes/auth.js'
import { createAuthGate } from './gate.js'
import { createLoginLimiter } from './login-limiter.js'

/**
 * 本物の門を組む（`main.ts` だけが呼ぶ）。
 *
 * **合言葉が無ければ、聞かずに入れる**（制作者 2026-10-16「初めて触るひとはいきなり認証画面
 * 出てきたら拒否反応出しそう」）。門そのものは残す。入る口が合言葉なしでクッキーを渡すだけで、
 * クッキーで来た書き込みの Origin は同じように見る（よそのページから手元の API を叩かせない）。
 *
 * **ただし、この Mac の外に開くなら合言葉が要る。** 無いまま組むと LAN の誰でも聞かれずに入れる。
 * そのときは組まない——API を起動させない。
 */
export const createAuth = (deps: {
  readonly passphrase: string | null
  /** 待ち受け先（`API_HOST`）。この Mac の中だけなら合言葉を省ける。 */
  readonly host: string
  readonly tokens: AccessTokenRepository
  readonly allowedOrigins: readonly string[]
  readonly logger: Logger
  readonly now?: () => Date
}): AppAuth => {
  if (deps.passphrase === null && !isLoopbackHost(deps.host)) {
    throw new Error(
      `API をこの Mac の外（API_HOST=${deps.host}）に開くには合言葉（IXA_PASSPHRASE）が要ります。` +
        '12 文字以上で .env に書いてから起動してください。',
    )
  }
  const now = deps.now ?? (() => new Date())
  return {
    gate: createAuthGate({ tokens: deps.tokens, allowedOrigins: deps.allowedOrigins, now, logger: deps.logger }),
    routes: authRoutes({
      passphrase: deps.passphrase,
      tokens: deps.tokens,
      limiter: createLoginLimiter(),
      now,
      logger: deps.logger,
    }),
  }
}

/** ルートのテスト用の、**誰でも通す**門。本物の門は `auth.test.ts` が確かめる。 */
export const openAuthForTests = (): AppAuth => ({
  gate: async (_c, next) => {
    await next()
  },
  routes: new OpenAPIHono(),
})
