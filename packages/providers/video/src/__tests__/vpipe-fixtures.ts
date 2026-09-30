import type { MediaAssetId, ShotGenerationSpec } from '@ixa/domain'
import type {
  VideoGenerationRequest,
  VideoModelDescriptor,
  VideoProvider,
} from '@ixa/provider-core'
import { vpipeH3TurboModel } from '../vpipe/descriptor.js'
import { createVpipeVideoProvider, type VpipeFetch } from '../vpipe/provider.js'

/**
 * vpipe-api の契約テストの小物。応答は vpipe-api の `docs/api.md` の例から作る。
 * **実サーバは叩かない**（CLAUDE.md テスト節）。
 */

export const BASE_URL = 'http://127.0.0.1:8765'
export const TOKEN = 'vpipe-test-token-0123'
export const JOB_ID = 'job_01J9ZK3N2Q8V7W6X5Y4Z3A2B1C'
export const SUBMIT_URL = `${BASE_URL}/v1/workflows/minimax-h3-turbo-video/jobs`
export const JOB_URL = `${BASE_URL}/v1/jobs/${JOB_ID}`
export const OUTPUT_URL = `${JOB_URL}/output`
export const HEALTH_URL = `${BASE_URL}/v1/health`

/** 開始画像の署名付き URL。**例外にも raw にも出てはいけない値**（規約 7）。 */
export const SIGNED_URL_PREFIX = 'http://127.0.0.1:9000/ixa-media/ref.png?X-Amz-Signature=secret'

/** PNG の頭 8 バイト + α。中身は何でもよいが、base64 の往復を確かめられる長さにする。 */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
])
export const MP4_BYTES = new Uint8Array(Array.from({ length: 64 }, (_unused, i) => i))

export const SUBMIT_BODY = {
  id: JOB_ID,
  workflow: 'minimax-h3-turbo-video',
  status: 'queued',
  created_at: '2026-09-30T12:00:00Z',
}

const JOB_TIMES = {
  id: JOB_ID,
  workflow: 'minimax-h3-turbo-video',
  created_at: '2026-09-30T12:00:00Z',
}

export const QUEUED_JOB = {
  ...JOB_TIMES,
  status: 'queued',
  progress: null,
  queue_position: 1,
  started_at: null,
  finished_at: null,
  result: null,
  error: null,
}

export const RUNNING_JOB = {
  ...JOB_TIMES,
  status: 'running',
  progress: 0.4,
  queue_position: null,
  started_at: '2026-09-30T12:00:01Z',
  finished_at: null,
  result: null,
  error: null,
}

/** docs/api.md の `GET /v1/jobs/{job_id}` の例そのもの。 */
export const SUCCEEDED_JOB = {
  ...JOB_TIMES,
  status: 'succeeded',
  progress: 1.0,
  queue_position: null,
  started_at: '2026-09-30T12:00:01Z',
  finished_at: '2026-09-30T12:07:10Z',
  result: {
    output: {
      media_type: 'video/mp4',
      width: 1920,
      height: 1080,
      frames: 124,
      fps: 24,
      duration_sec: 5.167,
    },
    seed_used: 12345,
    details: {
      generation: { width: 1024, height: 576, frames: 124, steps: 6, quality: 'standard' },
    },
  },
  error: null,
}

export const failedJob = (error: { code: string; message: string; retryable: boolean } | null) => ({
  ...JOB_TIMES,
  status: 'failed',
  progress: null,
  queue_position: null,
  started_at: '2026-09-30T12:00:01Z',
  finished_at: '2026-09-30T12:03:00Z',
  result: null,
  error,
})

export const CANCELED_JOB = {
  ...JOB_TIMES,
  status: 'canceled',
  progress: null,
  queue_position: null,
  started_at: null,
  finished_at: '2026-09-30T12:01:00Z',
  result: null,
  error: null,
}

export const errorEnvelope = (code: string, retryable: boolean, message = 'human readable') => ({
  error: { code, message, retryable, details: null },
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

export const createFetch = (handler: Handler): { calls: Call[]; fetch: VpipeFetch } => {
  const calls: Call[] = []
  const fetch: VpipeFetch = (url, init) => {
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

export const makeVpipeProvider = (
  fetch: VpipeFetch,
  outputDir: string,
  token?: string,
): VideoProvider =>
  createVpipeVideoProvider({
    baseUrl: BASE_URL,
    outputDir,
    fetch,
    ...(token === undefined ? {} : { token }),
  })

export const resolveReference = (id: MediaAssetId): Promise<string> =>
  Promise.resolve(`${SIGNED_URL_PREFIX}&id=${id}`)

export const vpipeRequestFor = (
  spec: ShotGenerationSpec,
  model: VideoModelDescriptor = vpipeH3TurboModel,
): VideoGenerationRequest => ({ model, spec, resolveReference })

/** 文字列のどこにも URL やトークンが現れないこと。 */
export const leaksSecret = (text: string): boolean =>
  text.includes('http') || text.includes('://') || text.includes('X-Amz') || text.includes(TOKEN)

/** `GET /v1/health`（docs/api.md の例）。既定は空き（走っている 0 本・待ち 0 本・待ちの枠 1）。 */
export const healthBody = (running = 0, waiting = 0, maxWaiting = 1) => ({
  status: 'ok',
  version: '0.1.0',
  running,
  waiting,
  max_waiting: maxWaiting,
})

type Responder = (url: string, init: RequestInit) => Response | Promise<Response>

/**
 * サーバとストレージを 1 つの口で振る舞う。空きの確認・開始画像（署名付き URL）・投入を振り分ける。
 * 渡さなかったものは既定（空き・PNG）で答える。
 */
export const serverRoutes =
  (routes: { submit: Responder; image?: Responder; health?: Responder }): Handler =>
  (url, init) => {
    if (url === HEALTH_URL)
      return (routes.health ?? (() => jsonResponse(200, healthBody())))(url, init)
    if (url.startsWith(SIGNED_URL_PREFIX)) {
      return (routes.image ?? (() => bytesResponse(PNG_BYTES, 'image/png')))(url, init)
    }
    return routes.submit(url, init)
  }

/** 投入の呼び出し（POST）だけを取り出す。 */
export const submitCallOf = (calls: readonly Call[]): Call | undefined =>
  calls.find((call) => call.url === SUBMIT_URL && call.method === 'POST')

/** Node の `fetch` が接続を拒まれたときの形（`TypeError: fetch failed` の cause に code）。 */
export const connectionRefused = (): Promise<Response> =>
  Promise.reject(
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8765'), {
        code: 'ECONNREFUSED',
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
