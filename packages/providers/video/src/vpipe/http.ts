import { ProviderError } from '@ixa/provider-core'
import { clipReason, redactPaths, redactUrls } from '../common/reason.js'
import { VpipeErrorEnvelope } from './api.js'
import { VPIPE_PROVIDER_ID } from './descriptor.js'

/**
 * 注入できる `fetch`。**実サーバを CI で叩かないため、口を引数で受ける**（CLAUDE.md テスト節）。
 * 参照画像（署名付き URL）の取得もこの口を通すので、テストは応答を差し替えるだけで完結する。
 */
export type VpipeFetch = (url: string, init: RequestInit) => Promise<Response>

export class VpipeRequestError extends ProviderError {
  override readonly name = 'VpipeRequestError'

  constructor(
    readonly code: string,
    message: string,
    retryable: boolean,
    readonly status: number | null,
    options?: { cause?: unknown },
  ) {
    super(message, VPIPE_PROVIDER_ID, retryable, options)
  }
}

/** 画面に出る文の頭。実装の名前（worker / API）は入れない。 */
export const VPIPE_LABEL = 'ローカルの動画生成（vpipe）'

/** サーバの `code` は機械向けの識別子。コードに使う前に記号を落とす。 */
export const vpipeCode = (serverCode: string): string => {
  const cleaned = serverCode.replace(/[^A-Za-z0-9_]/g, '')
  return cleaned === '' ? 'vpipe_error' : `vpipe_${cleaned}`
}

/**
 * 封筒（`{ error: {...} }`）が読めなかったときの切り分け。契約の表（docs/api.md）に合わせる。
 * 再試行して意味があるのは 429（満杯）と 5xx（向こう側の不調）だけ。
 */
const fallbackCodeFor = (status: number): string => {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 413) return 'payload_too_large'
  if (status === 422) return 'invalid_params'
  if (status === 429) return 'busy'
  if (status >= 500) return 'internal'
  return 'bad_request'
}

const isRetryableHttpStatus = (status: number): boolean => status === 429 || status >= 500

/**
 * サーバの文を理由として運ぶ。URL と絶対パス（手元の置き場所・利用者の名前）は落とし、長すぎれば切る。
 * 手元のサーバの例外文には `/Users/<名前>/…` が混ざりやすく、そのまま画面に出てしまう。
 */
export const reasonOf = (text: string): string =>
  clipReason(redactPaths(redactUrls(text)), '理由不明')

/**
 * 非 2xx を `ProviderError` にする。**やり直せるかはサーバの `retryable` を正とする。**
 * 封筒が読めないとき（プロキシが挟まった等）だけ HTTP の状態で判断する。
 */
export const vpipeErrorFor = (status: number, body: unknown, what: string): VpipeRequestError => {
  const envelope = VpipeErrorEnvelope.safeParse(body)
  const head = `${VPIPE_LABEL}の${what}が失敗しました（HTTP ${String(status)}）`
  if (envelope.success) {
    const { code, message, retryable } = envelope.data.error
    return new VpipeRequestError(
      vpipeCode(code),
      `${head}: ${reasonOf(message)}`,
      retryable,
      status,
    )
  }
  return new VpipeRequestError(
    vpipeCode(fallbackCodeFor(status)),
    `${head}: 理由不明`,
    isRetryableHttpStatus(status),
    status,
  )
}

/**
 * `Retry-After`（秒 or HTTP 日付）をミリ秒にする。読めなければ null（待つ長さは worker が決める）。
 */
export const retryAfterMsFrom = (headers: Headers, now: number = Date.now()): number | null => {
  const value = headers.get('retry-after')?.trim() ?? ''
  if (value === '') return null
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

export type VpipeHttp = {
  readonly fetch: VpipeFetch
  /** 末尾の `/` を落とした基底 URL。 */
  readonly baseUrl: string
  /** 設定されていれば `Authorization: Bearer` で送る。**本文にもクエリにも載せない。** */
  readonly token: string | null
  /** 1 回の HTTP（本文の読み取りまで含む）に掛ける上限。 */
  readonly timeoutMs: number
}

export type VpipeHttpResult = {
  readonly status: number
  readonly ok: boolean
  readonly headers: Headers
  readonly body: unknown
}

const authHeaders = (http: VpipeHttp): Record<string, string> =>
  http.token === null ? {} : { Authorization: `Bearer ${http.token}` }

/**
 * 要求がサーバに**届いていない**と言い切れる失敗（接続拒否・名前が引けない・経路が無い）。
 * サーバが止まっているときの形で、投入なら何も積まれていない。
 */
export const VPIPE_UNREACHABLE = 'vpipe_unreachable'

/**
 * 要求を送ったかもしれないのに応答が無い失敗（時間切れ・途中で切れた・本文が読めない）。
 * **投入ならサーバが受け付けているかもしれない。** 呼び出し側は「失敗した」と決めつけない。
 */
export const VPIPE_NO_RESPONSE = 'vpipe_no_response'

const NOT_SENT_CODES: ReadonlySet<string> = new Set([
  // 接続が時間内に張れなかった（別の Mac が眠っている・LAN の向こうで落ちている）。張れていないので何も送っていない。
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
])

const systemCodeOf = (value: unknown): string | null =>
  typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
    ? value.code
    : null

/**
 * `fetch` の失敗が「接続すらできなかった」ものか。Node の `fetch` は `TypeError: fetch failed` の
 * `cause` に接続の失敗を持つ（IPv4 と IPv6 を両方試したときは `AggregateError`）。
 * **分からないものは「届いたかもしれない」に倒す**（届いていないと決めつけると二重に生成しうる）。
 */
export const wasNeverSent = (error: unknown): boolean => {
  const cause: unknown = error instanceof Error ? error.cause : undefined
  const direct = systemCodeOf(cause)
  if (direct !== null && NOT_SENT_CODES.has(direct)) return true
  if (!(cause instanceof AggregateError)) return false
  const errors: readonly unknown[] = cause.errors
  return errors.length > 0 && errors.every((inner) => NOT_SENT_CODES.has(systemCodeOf(inner) ?? ''))
}

/** 通信そのものの失敗。**どちらもやり直せる**（サーバの再起動中など、待てば通ることが多い）。 */
const transportFailure = (method: string, cause: unknown, sent: boolean): VpipeRequestError =>
  !sent && wasNeverSent(cause)
    ? new VpipeRequestError(
        VPIPE_UNREACHABLE,
        `${VPIPE_LABEL}のサーバへ接続できませんでした（${method}）。vpipe-api が起動しているか確かめてください`,
        true,
        null,
        { cause },
      )
    : new VpipeRequestError(
        VPIPE_NO_RESPONSE,
        `${VPIPE_LABEL}のサーバから応答が返りませんでした（${method}。時間切れか、接続が途中で切れました）`,
        true,
        null,
        { cause },
      )

const send = async (
  http: VpipeHttp,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  init: {
    readonly headers: Record<string, string>
    readonly body?: string
    readonly signal: AbortSignal
  },
): Promise<Response> => {
  try {
    return await http.fetch(`${http.baseUrl}${path}`, {
      method,
      headers: { ...authHeaders(http), ...init.headers },
      signal: init.signal,
      ...(init.body === undefined ? {} : { body: init.body }),
    })
  } catch (cause) {
    // **URL を載せない。** 経路の秘密ではないが、載せる習慣を作らない（fal と同じ）。
    throw transportFailure(method, cause, false)
  }
}

/**
 * JSON の口を 1 回叩く。**非 2xx でもここでは投げない。**
 * 取消の 409 や投入の 429 のように、失敗かどうかを呼び出し側にしか決められない応答があるため。
 */
export const vpipeRequest = async (
  http: VpipeHttp,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  payload?: unknown,
  /** 冪等キーなど、この要求だけに付けるヘッダ。 */
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<VpipeHttpResult> => {
  const signal = AbortSignal.timeout(http.timeoutMs)
  const response = await send(http, method, path, {
    headers: {
      accept: 'application/json',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...extraHeaders,
    },
    signal,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })

  const text = await (async (): Promise<string> => {
    try {
      return await response.text()
    } catch (cause) {
      /**
       * **本文が読めなかったのは通信の失敗であって、応答の形の違いではない。**
       * 時間切れでも、サーバの再起動で接続が切れた（`TypeError: terminated`）のでも同じ。
       * 形の違いとして扱うと、問い合わせでは長い生成を終端の失敗にして捨て、投入では
       * サーバが受け付けたかもしれないジョブを「失敗」と決めつけてしまう。
       */
      throw transportFailure(method, cause, true)
    }
  })()

  const body = ((): unknown => {
    if (text === '') return undefined
    try {
      return JSON.parse(text) as unknown
    } catch {
      // 本文が JSON でないことは理由にならない。status だけで判断させる。
      return undefined
    }
  })()

  return { status: response.status, ok: response.ok, headers: response.headers, body }
}

/**
 * 本文を読まずに応答を返す（出力の mp4 を流しながら書くため）。
 * 返した応答の本文は `signal` の時間切れで打ち切られる。
 */
export const vpipeOpen = async (
  http: VpipeHttp,
  path: string,
  accept: string,
): Promise<{ readonly response: Response; readonly signal: AbortSignal }> => {
  const signal = AbortSignal.timeout(http.timeoutMs)
  const response = await send(http, 'GET', path, { headers: { accept }, signal })
  return { response, signal }
}

/** 失敗した応答の本文を読んで捨てる。封筒があれば理由に使う。 */
export const readErrorBody = async (response: Response): Promise<unknown> => {
  try {
    return JSON.parse(await response.text()) as unknown
  } catch {
    return undefined
  }
}
