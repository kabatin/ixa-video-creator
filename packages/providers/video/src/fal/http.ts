import { ProviderError } from '@ixa/provider-core'
import { clipReason, redactUrls } from '../common/reason.js'
import { FAL_PROVIDER_ID } from './descriptor.js'

/**
 * 注入できる `fetch`。**実 API を CI で叩かないため、口を引数で受ける**（CLAUDE.md テスト節）。
 * グローバルの `fetch` より狭いので、そのまま包んで渡せる。
 */
export type FalFetch = (url: string, init: RequestInit) => Promise<Response>

export type FalErrorCode =
  | 'fal_unauthorized'
  | 'fal_rate_limited'
  | 'fal_bad_request'
  | 'fal_server_error'
  | 'fal_unreachable'
  | 'fal_invalid_response'

export class FalRequestError extends ProviderError {
  override readonly name = 'FalRequestError'

  constructor(
    readonly code: string,
    message: string,
    retryable: boolean,
    readonly status: number | null,
    options?: { cause?: unknown },
  ) {
    super(message, FAL_PROVIDER_ID, retryable, options)
  }
}

/**
 * 再試行して意味があるのは **429（レート制限）と 5xx（向こう側の不調）だけ**。
 * それ以外の 4xx は入力不正か認証の失敗で、同じ要求を投げ直しても同じ結果になる。
 */
export const isRetryableHttpStatus = (status: number): boolean => status === 429 || status >= 500

export const falErrorCodeFor = (status: number): FalErrorCode => {
  if (status === 401 || status === 403) return 'fal_unauthorized'
  if (status === 429) return 'fal_rate_limited'
  if (status >= 500) return 'fal_server_error'
  return 'fal_bad_request'
}

/**
 * 理由の下ごしらえ（URL を落とす・長さを切る）は vpipe と共有する（`common/reason.ts`）。
 * 公開の名前はここからも引けるように残す。
 */
export { formatIssues, redactUrls } from '../common/reason.js'

/** 応答本文から人が読める理由を取り出す。長すぎるものは切る。 */
export const reasonFrom = (body: unknown, fallback: string): string => {
  const picked = ((): string | null => {
    if (typeof body === 'string') return body
    if (typeof body !== 'object' || body === null) return null
    for (const key of ['detail', 'error', 'message'] as const) {
      const value = (body as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.trim() !== '') return value
    }
    return null
  })()

  return clipReason(redactUrls(picked ?? fallback), fallback)
}

export const falErrorFor = (status: number, body: unknown, what: string): FalRequestError =>
  new FalRequestError(
    falErrorCodeFor(status),
    `fal の${what}が失敗しました（HTTP ${String(status)}）: ${reasonFrom(body, '理由不明')}`,
    isRetryableHttpStatus(status),
    status,
  )

export type FalHttp = {
  readonly fetch: FalFetch
  readonly apiKey: string
  readonly baseUrl: string
  readonly timeoutMs: number
}

export type FalHttpResult = {
  readonly status: number
  readonly ok: boolean
  readonly body: unknown
}

/**
 * Queue API を 1 回叩く。**非 2xx でもここでは投げない。**
 * 取消のように 400 / 404 が正常な応答である経路があり、
 * 「失敗かどうか」は呼び出し側にしか決められないため。
 */
export const falRequest = async (
  http: FalHttp,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
): Promise<FalHttpResult> => {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Key ${http.apiKey}`,
      accept: 'application/json',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    signal: AbortSignal.timeout(http.timeoutMs),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }

  const response = await (async (): Promise<Response> => {
    try {
      return await http.fetch(url, init)
    } catch (cause) {
      // **URL を載せない。** 経路の秘密ではないが、載せる習慣を作らない。
      throw new FalRequestError(
        'fal_unreachable',
        `fal へ接続できませんでした（${method}）`,
        true,
        null,
        { cause },
      )
    }
  })()

  const body = await (async (): Promise<unknown> => {
    try {
      return await response.json()
    } catch {
      // 本文が JSON でないことは理由にならない。status だけで判断させる。
      return undefined
    }
  })()

  return { status: response.status, ok: response.ok, body }
}
