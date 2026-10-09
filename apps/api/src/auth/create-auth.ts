import { OpenAPIHono } from '@hono/zod-openapi'
import type { AccessTokenRepository } from '@ixa/db'
import type { Logger } from 'pino'
import type { AppAuth } from '../app.js'
import { authRoutes } from '../routes/auth.js'
import { createAuthGate } from './gate.js'
import { createLoginLimiter } from './login-limiter.js'

/**
 * 本物の門を組む（`main.ts` だけが呼ぶ）。**合言葉が無ければ組まない**——API を起動させない。
 * 無いまま起動すると、門を開けたまま LAN に待ち受けることになる。
 */
export const createAuth = (deps: {
  readonly passphrase: string | null
  readonly tokens: AccessTokenRepository
  readonly allowedOrigins: readonly string[]
  readonly logger: Logger
  readonly now?: () => Date
}): AppAuth => {
  if (deps.passphrase === null) {
    throw new Error(
      '合言葉（IXA_PASSPHRASE）が設定されていません。12 文字以上で .env に書いてから起動してください。',
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
