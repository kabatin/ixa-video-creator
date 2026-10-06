import type { ShotGenerationSpec } from '@ixa/domain'
import type {
  VideoGenerationRequest,
  VideoModelDescriptor,
  VideoProvider,
} from '@ixa/provider-core'
import type { LocalServerFetch } from '../local-server/http.js'
import { wanTi2v5bModel } from '../wan/descriptor.js'
import { createWanVideoProvider } from '../wan/provider.js'
import {
  leaksSecretOf,
  resolveReference,
  serverRoutesFor,
  type Call,
} from './local-server-fixtures.js'

/**
 * wan-api の契約テストの小物（ADR-0040）。
 *
 * **応答の形は vpipe-api の `docs/api.md`（v1）そのまま。** wan-api はこの契約に合わせる取り決めなので、
 * 違うのはワークフロー名・投入の本文・サーバが返す実測値だけ。通信まわりは
 * `local-server-fixtures.ts` と共有する（**実サーバは叩かない**）。
 */

export const WAN_BASE_URL = 'http://127.0.0.1:8766'
export const WAN_TOKEN = 'wan-test-token-0123456789abcdef'
export const WAN_JOB_ID = 'job_01M3WN7KQ4ZB8HXAPKJ51QE9MN'
export const WAN_SUBMIT_URL = `${WAN_BASE_URL}/v1/workflows/wan2.2-ti2v-5b/jobs`
export const WAN_JOB_URL = `${WAN_BASE_URL}/v1/jobs/${WAN_JOB_ID}`
export const WAN_OUTPUT_URL = `${WAN_JOB_URL}/output`
export const WAN_HEALTH_URL = `${WAN_BASE_URL}/v1/health`

export const WAN_SUBMIT_BODY = {
  id: WAN_JOB_ID,
  workflow: 'wan2.2-ti2v-5b',
  status: 'queued',
  created_at: '2026-10-06T12:00:00Z',
}

const JOB_TIMES = {
  id: WAN_JOB_ID,
  workflow: 'wan2.2-ti2v-5b',
  created_at: '2026-10-06T12:00:00Z',
}

export const WAN_QUEUED_JOB = {
  ...JOB_TIMES,
  status: 'queued',
  progress: null,
  queue_position: 1,
  started_at: null,
  finished_at: null,
  result: null,
  error: null,
}

export const WAN_RUNNING_JOB = {
  ...JOB_TIMES,
  status: 'running',
  progress: 0.25,
  queue_position: null,
  started_at: '2026-10-06T12:00:30Z',
  finished_at: null,
  result: null,
  error: null,
}

/**
 * 成功の応答。**頼んだ尺ちょうどに揃えて返す**という契約を、数字で表している:
 * 3.4583 秒（83 コマ）を頼み、サーバは 4n+1 に載る 85 コマを作って 83 コマへ切り詰めた。
 * だから `output.frames`（83）と `details.generation.frames`（85）は食い違う。
 */
export const WAN_SUCCEEDED_JOB = {
  ...JOB_TIMES,
  status: 'succeeded',
  progress: 1.0,
  queue_position: null,
  started_at: '2026-10-06T12:00:30Z',
  finished_at: '2026-10-06T12:08:10Z',
  estimate_seconds: 675.0,
  cancel_requested: false,
  /**
   * サーバが測った秒数。**実測の形に合わせてある**（wan-api の `docs/benchmark.md` の run A:
   * draft・5 秒・新しい文章で 674.7 秒、うちノイズ除去 378.1 秒）。
   */
  timings: {
    queue_seconds: 0.8,
    backend_seconds: 674.7,
    sampling_seconds: 378.1,
    postprocess_seconds: 0.7,
    total_seconds: 676.2,
  },
  result: {
    output: {
      media_type: 'video/mp4',
      width: 1920,
      height: 1080,
      frames: 83,
      fps: 24,
      duration_sec: 3.458,
    },
    seed_used: 4242,
    details: {
      generation: { width: 1280, height: 704, frames: 85, quality: 'standard' },
    },
  },
  error: null,
}

export const wanFailedJob = (
  error: { code: string; message: string; retryable: boolean } | null,
) => ({
  ...JOB_TIMES,
  status: 'failed',
  progress: null,
  queue_position: null,
  started_at: '2026-10-06T12:00:30Z',
  finished_at: '2026-10-06T12:02:00Z',
  result: null,
  error,
})

/** 契約の綴りは `canceled`。 */
export const WAN_CANCELED_JOB = {
  ...JOB_TIMES,
  status: 'canceled',
  progress: null,
  queue_position: null,
  started_at: null,
  finished_at: '2026-10-06T12:01:00Z',
  result: null,
  error: null,
}

/** 同じ契約を実装したサーバが素直に書きそうな綴り（`cancelled`）。どちらでも取り消しとして扱う。 */
export const WAN_CANCELLED_JOB = { ...WAN_CANCELED_JOB, status: 'cancelled' }

export const makeWanProvider = (
  fetch: LocalServerFetch,
  outputDir: string,
  token?: string,
): VideoProvider =>
  createWanVideoProvider({
    baseUrl: WAN_BASE_URL,
    outputDir,
    fetch,
    // サーバのエラーで投げ直すまで待たない（テストを遅くしない）。
    serverErrorRetryDelayMs: 0,
    ...(token === undefined ? {} : { token }),
  })

export const wanRequestFor = (
  spec: ShotGenerationSpec,
  model: VideoModelDescriptor = wanTi2v5bModel,
): VideoGenerationRequest => ({ model, spec, resolveReference })

/** 文字列のどこにも URL やトークンが現れないこと。 */
export const wanLeaksSecret = leaksSecretOf(WAN_TOKEN)

export const wanServerRoutes = serverRoutesFor(WAN_HEALTH_URL)

/** 投入の呼び出し（POST）だけを取り出す。 */
export const wanSubmitCallOf = (calls: readonly Call[]): Call | undefined =>
  calls.find((call) => call.url === WAN_SUBMIT_URL && call.method === 'POST')
