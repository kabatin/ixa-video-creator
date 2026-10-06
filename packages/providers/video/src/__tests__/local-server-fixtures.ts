import type { MediaAssetId } from '@ixa/domain'
import type { LocalServerFetch } from '../local-server/http.js'

/**
 * 手元の生成サーバ（**vpipe-api v1 契約**）の契約テストの小物。
 * vpipe（MiniMax H3）と wan（Wan 2.2）はどちらもこの契約を話すので、通信まわりの小物はここに置く。
 * サーバごとに違うもの（URL・ジョブの本文・モデル）は `vpipe-fixtures.ts` / `wan-fixtures.ts`。
 *
 * **実サーバは叩かない**（CLAUDE.md テスト節）。
 */

/** 開始画像の署名付き URL。**例外にも raw にも出てはいけない値**（規約 7）。 */
export const SIGNED_URL_PREFIX = 'http://127.0.0.1:9000/ixa-media/ref.png?X-Amz-Signature=secret'

/** PNG の頭 8 バイト + α。中身は何でもよいが、base64 の往復を確かめられる長さにする。 */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
])
export const MP4_BYTES = new Uint8Array(Array.from({ length: 64 }, (_unused, i) => i))

export const errorEnvelope = (code: string, retryable: boolean, message = 'human readable') => ({
  error: { code, message, retryable, details: null },
})

/** `GET /v1/health`（docs/api.md の例）。既定は空き（走っている 0 本・待ち 0 本・待ちの枠 1）。 */
export const healthBody = (running = 0, waiting = 0, maxWaiting = 1) => ({
  status: 'ok',
  version: '0.1.0',
  running,
  waiting,
  max_waiting: maxWaiting,
})

export const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

export const bytesResponse = (bytes: Uint8Array, contentType: string, status = 200): Response =>
  new Response(bytes, { status, headers: { 'content-type': contentType } })

export type Call = {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  /** 送った本文。文字列だけ控える。 */
  readonly body: string
}

export type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

export const createFetch = (handler: Handler): { calls: Call[]; fetch: LocalServerFetch } => {
  const calls: Call[] = []
  const fetch: LocalServerFetch = (url, init) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : '',
    })
    return Promise.resolve(handler(url, init))
  }
  return { calls, fetch }
}

export const resolveReference = (id: MediaAssetId): Promise<string> =>
  Promise.resolve(`${SIGNED_URL_PREFIX}&id=${id}`)

/** 文字列のどこにも URL やトークンが現れないこと。 */
export const leaksSecretOf =
  (token: string) =>
  (text: string): boolean =>
    text.includes('http') || text.includes('://') || text.includes('X-Amz') || text.includes(token)

export type Responder = (url: string, init: RequestInit) => Response | Promise<Response>

/**
 * サーバとストレージを 1 つの口で振る舞う。空きの確認・開始画像（署名付き URL）・投入を振り分ける。
 * 渡さなかったものは既定（空き・PNG）で答える。
 */
export const serverRoutesFor =
  (healthUrl: string) =>
  (routes: { submit: Responder; image?: Responder; health?: Responder }): Handler =>
  (url, init) => {
    if (url === healthUrl) return (routes.health ?? (() => jsonResponse(200, healthBody())))(url, init)
    if (url.startsWith(SIGNED_URL_PREFIX)) {
      return (routes.image ?? (() => bytesResponse(PNG_BYTES, 'image/png')))(url, init)
    }
    return routes.submit(url, init)
  }

/** Node の `fetch` が接続を拒まれたときの形（`TypeError: fetch failed` の cause に code）。 */
export const connectionRefused = (): Promise<Response> =>
  Promise.reject(
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8765'), {
        code: 'ECONNREFUSED',
      }),
    }),
  )

/** 接続が時間内に張れなかった形（undici の `ConnectTimeoutError`）。何も送っていない。 */
export const connectTimeout = (): Promise<Response> =>
  Promise.reject(
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('Connect Timeout Error (attempted address: 192.168.0.10:8765)'), {
        code: 'UND_ERR_CONNECT_TIMEOUT',
      }),
    }),
  )

/** 送ったあとで接続が切れた形（届いたかどうか分からない）。 */
export const connectionReset = (): Promise<Response> =>
  Promise.reject(
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
    }),
  )

/** 状態行とヘッダは返ったのに、本文の途中で切れる応答（サーバの再起動。abort ではない）。 */
export const truncatedResponse = (status = 200, contentType = 'application/json'): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":"job_'))
        controller.error(new TypeError('terminated'))
      },
    }),
    { status, headers: { 'content-type': contentType } },
  )

/**
 * 本文を少しだけ返して止まる応答。`init.signal` の時間切れで本文が打ち切られる
 * （実際の `fetch` と同じく、要求の signal が本文の読み取りにも効く）。
 */
export const stallingResponse = (init: RequestInit, contentType: string): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        init.signal?.addEventListener('abort', () => {
          controller.error(init.signal?.reason)
        })
      },
    }),
    { headers: { 'content-type': contentType } },
  )
