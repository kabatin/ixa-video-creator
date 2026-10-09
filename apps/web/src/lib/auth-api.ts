import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 入る・出る・アクセス用の鍵（認証。2026-10-09）。
 *
 * **鍵そのものは、発行した応答（`issueToken`）でしか受け取らない。** 一覧にも出ない。
 */

export const WireAccessToken = z.object({
  id: z.string().min(1),
  kind: z.enum(['browser', 'automation']),
  label: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
})
export type WireAccessToken = z.infer<typeof WireAccessToken>

const WireIssuedToken = z.object({ accessToken: WireAccessToken, token: z.string().min(1) })
export type WireIssuedToken = z.infer<typeof WireIssuedToken>

export type AuthApi = {
  /** 合言葉で入る。成功するとブラウザにクッキーが付く。 */
  login: (passphrase: string) => Promise<WireAccessToken>
  /** この端末の鍵を取り消して出る。 */
  logout: () => Promise<void>
  listAccessTokens: () => Promise<readonly WireAccessToken[]>
  issueAccessToken: (label: string) => Promise<WireIssuedToken>
  /** 取り消す。取り消したあとは一覧を読み直す（応答の本文は使わない）。 */
  revokeAccessToken: (id: string) => Promise<void>
}

export const createAuthApi = (requester: Requester): AuthApi => ({
  login: (passphrase) => requester.post('/auth/login', { passphrase }, WireAccessToken),
  logout: async () => {
    await requester.post('/auth/logout', undefined, z.object({}))
  },
  listAccessTokens: () => requester.get('/auth/tokens', z.array(WireAccessToken)),
  issueAccessToken: (label) => requester.post('/auth/tokens', { label }, WireIssuedToken),
  revokeAccessToken: (id) => requester.remove(`/auth/tokens/${encodeURIComponent(id)}`),
})
