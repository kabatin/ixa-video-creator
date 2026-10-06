import type { ShotGenerationSpec } from '@ixa/domain'
import type {
  VideoGenerationRequest,
  VideoModelDescriptor,
  VideoProvider,
} from '@ixa/provider-core'
import { vpipeH3TurboModel } from '../vpipe/descriptor.js'
import { createVpipeVideoProvider, type VpipeFetch } from '../vpipe/provider.js'
import {
  leaksSecretOf,
  resolveReference,
  serverRoutesFor,
  type Call,
} from './local-server-fixtures.js'

/**
 * vpipe-api の契約テストの小物。応答は vpipe-api の `docs/api.md` の例から作る。
 * **実サーバは叩かない**（CLAUDE.md テスト節）。
 *
 * 通信まわり（応答の作り方・接続の失敗の形・`fetch` の記録）は、同じ契約を話す wan とも共有する
 * （`local-server-fixtures.ts`）。ここに置くのは vpipe-api 固有のもの（URL・ジョブの本文・モデル）だけ。
 */
export {
  bytesResponse,
  connectionRefused,
  connectionReset,
  connectTimeout,
  createFetch,
  errorEnvelope,
  healthBody,
  jsonResponse,
  MP4_BYTES,
  PNG_BYTES,
  resolveReference,
  SIGNED_URL_PREFIX,
  stallingResponse,
  truncatedResponse,
  type Call,
  type Handler,
} from './local-server-fixtures.js'

export const BASE_URL = 'http://127.0.0.1:8765'
export const TOKEN = 'vpipe-test-token-0123'
export const JOB_ID = 'job_01J9ZK3N2Q8V7W6X5Y4Z3A2B1C'
export const SUBMIT_URL = `${BASE_URL}/v1/workflows/minimax-h3-turbo-video/jobs`
export const JOB_URL = `${BASE_URL}/v1/jobs/${JOB_ID}`
export const OUTPUT_URL = `${JOB_URL}/output`
export const HEALTH_URL = `${BASE_URL}/v1/health`

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

export const makeVpipeProvider = (
  fetch: VpipeFetch,
  outputDir: string,
  token?: string,
): VideoProvider =>
  createVpipeVideoProvider({
    baseUrl: BASE_URL,
    outputDir,
    fetch,
    // サーバのエラーで投げ直すまで待たない（テストを遅くしない）。
    serverErrorRetryDelayMs: 0,
    ...(token === undefined ? {} : { token }),
  })

export const vpipeRequestFor = (
  spec: ShotGenerationSpec,
  model: VideoModelDescriptor = vpipeH3TurboModel,
): VideoGenerationRequest => ({ model, spec, resolveReference })

/** 文字列のどこにも URL やトークンが現れないこと。 */
export const leaksSecret = leaksSecretOf(TOKEN)

/**
 * サーバとストレージを 1 つの口で振る舞う。空きの確認・開始画像（署名付き URL）・投入を振り分ける。
 * 渡さなかったものは既定（空き・PNG）で答える。
 */
export const serverRoutes = serverRoutesFor(HEALTH_URL)

/** 投入の呼び出し（POST）だけを取り出す。 */
export const submitCallOf = (calls: readonly Call[]): Call | undefined =>
  calls.find((call) => call.url === SUBMIT_URL && call.method === 'POST')

/**
 * **実サーバから取った応答**（2026-09-30、M5 の Mac で動く vpipe-api 0.1.0。1280x720・56 コマの draft を
 * 文章だけから作った回）。文書の例より細かい（時刻がマイクロ秒まで入る）ので、形の食い違いはここで気付く。
 */
export const REAL_JOB_ID = 'job_01M3RBXYZ2HM6HXAPKJ51QE9MN'

export const REAL_SUCCEEDED_JOB = {
  id: REAL_JOB_ID,
  workflow: 'minimax-h3-turbo-video',
  status: 'succeeded',
  progress: 1.0,
  queue_position: null,
  created_at: '2026-09-30T05:17:23.298241Z',
  started_at: '2026-09-30T05:17:23.298989Z',
  finished_at: '2026-09-30T05:20:51.170482Z',
  result: {
    output: {
      media_type: 'video/mp4',
      width: 1280,
      height: 720,
      frames: 56,
      fps: 24,
      duration_sec: 2.333,
    },
    seed_used: 120698028,
    details: { generation: { width: 832, height: 480, frames: 56, steps: 6, quality: 'draft' } },
  },
  error: null,
}

/** 実サーバの 429（走っている 1 本と待ちの 1 本で埋まっていたとき）。`retry-after: 175` が付いていた。 */
export const REAL_BUSY_BODY = {
  error: {
    code: 'busy',
    message: 'the GPU slot and the waiting queue are full',
    retryable: true,
    details: null,
  },
}
export const REAL_BUSY_RETRY_AFTER = '175'
