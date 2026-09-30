import { z } from 'zod'
import { VpipeHealth } from './api.js'
import { VPIPE_UNREACHABLE, VpipeRequestError, vpipeRequest, type VpipeFetch } from './http.js'

/** 一覧を開くたびに叩くので短く（止まったサーバで画面を待たせない）。 */
const HEALTH_CHECK_TIMEOUT_MS = 2000

export type VpipeHealthCheck =
  | { readonly state: 'up'; readonly version: string | null }
  | { readonly state: 'down'; readonly reason: string }

const VersionOnly = z.object({ version: z.string() })

/**
 * 手元の生成サーバ（vpipe-api）が起動しているか（ADR-0032 の「使う AI」の一覧）。
 * **`GET /v1/health` だけを叩き、何も積まない。** 起動していないときは起こし方まで言う。
 */
export const checkVpipeHealth = async (input: {
  readonly baseUrl: string
  readonly token: string | null
  readonly fetch?: VpipeFetch
}): Promise<VpipeHealthCheck> => {
  const http = {
    fetch: input.fetch ?? globalThis.fetch,
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    token: input.token,
    timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
  }
  try {
    const response = await vpipeRequest(http, 'GET', '/v1/health')
    if (response.status === 401 || response.status === 403) {
      return { state: 'down', reason: '合言葉（VPIPE_API_TOKEN）が合いません' }
    }
    if (!response.ok)
      return { state: 'down', reason: `応答が異常です（${String(response.status)}）` }
    if (!VpipeHealth.safeParse(response.body).success) {
      return {
        state: 'down',
        reason: 'vpipe-api ではないものが応答しています（VPIPE_API_URL を確かめてください）',
      }
    }
    const version = VersionOnly.safeParse(response.body)
    return { state: 'up', version: version.success ? version.data.version : null }
  } catch (error) {
    if (!(error instanceof VpipeRequestError)) throw error
    return error.code === VPIPE_UNREACHABLE
      ? { state: 'down', reason: '起動していません（vpipe-api serve で起動します）' }
      : { state: 'down', reason: '応答がありません（時間切れか、接続が途中で切れました）' }
  }
}
