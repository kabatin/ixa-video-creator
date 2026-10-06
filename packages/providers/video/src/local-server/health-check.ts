import { z } from 'zod'
import { LocalServerHealth } from './api.js'
import { localServerUnreachableCode, type LocalServerIdentity } from './identity.js'
import {
  localServerRequest,
  LocalServerRequestError,
  type LocalServerFetch,
  type LocalServerHttp,
} from './http.js'

/** 一覧を開くたびに叩くので短く（止まったサーバで画面を待たせない）。 */
const HEALTH_CHECK_TIMEOUT_MS = 2000

export type LocalServerHealthCheck =
  | { readonly state: 'up'; readonly version: string | null }
  | { readonly state: 'down'; readonly reason: string }

const VersionOnly = z.object({ version: z.string() })

/**
 * 手元の生成サーバが起動しているか（ADR-0032 の「使う AI」の一覧）。
 * **`GET /v1/health` だけを叩き、何も積まない。** 起動していないときは起こし方まで言う。
 */
export const checkLocalServerHealth = async (input: {
  readonly identity: LocalServerIdentity
  readonly baseUrl: string
  readonly token: string | null
  readonly fetch?: LocalServerFetch
}): Promise<LocalServerHealthCheck> => {
  const { identity } = input
  const http: LocalServerHttp = {
    identity,
    fetch: input.fetch ?? globalThis.fetch,
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    token: input.token,
    timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
  }
  try {
    const response = await localServerRequest(http, 'GET', '/v1/health')
    if (response.status === 401 || response.status === 403) {
      return { state: 'down', reason: `合言葉（${identity.tokenEnvName}）が合いません` }
    }
    if (!response.ok)
      return { state: 'down', reason: `応答が異常です（${String(response.status)}）` }
    if (!LocalServerHealth.safeParse(response.body).success) {
      return {
        state: 'down',
        reason: `${identity.serverName} ではないものが応答しています（${identity.urlEnvName} を確かめてください）`,
      }
    }
    const version = VersionOnly.safeParse(response.body)
    return { state: 'up', version: version.success ? version.data.version : null }
  } catch (error) {
    if (!(error instanceof LocalServerRequestError)) throw error
    return error.code === localServerUnreachableCode(identity)
      ? { state: 'down', reason: identity.startHint }
      : { state: 'down', reason: '応答がありません（時間切れか、接続が途中で切れました）' }
  }
}
