import type { MediaAssetId, ShotGenerationSpec } from '@ixa/domain'
import { CapabilityViolationError, ProviderError } from '@ixa/provider-core'
import type { ProviderJobStatus, VideoModelDescriptor, VideoProvider } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import {
  FAL_QUEUE_BASE_URL,
  FAL_SEEDANCE_COST_PER_SECOND_USD,
  FAL_SEEDANCE_REFERENCE_TO_VIDEO_PATH,
  falSeedanceReferenceToVideoModel,
} from '../fal/descriptor.js'
import { decodeFalJobRef } from '../fal/job-ref.js'
import { createFalVideoProvider, type FalFetch } from '../fal/provider.js'
import { makeSpec, SHOT_ID_A } from './fixtures.js'

const API_KEY = 'fal-test-key'
const REQUEST_ID = '9f3a-1234-req'
const MODEL = falSeedanceReferenceToVideoModel
const ENDPOINT = `${FAL_QUEUE_BASE_URL}/${FAL_SEEDANCE_REFERENCE_TO_VIDEO_PATH}`

/** 経路が 2.5 を指していること。ここがずれると全部のモックが別のモデルを叩く。 */
const EXPECTED_PATH = 'bytedance/seedance-2.5/reference-to-video'

/** 期限付きの署名付き URL。**例外にも raw にも出てはいけない値**（規約 7）。 */
const SIGNED_REFERENCE_URL = 'https://s3.example.com/ref-a.png?X-Amz-Signature=secret'
/** Provider が返す出力 URL。これも外へ出さない。 */
const OUTPUT_URL = 'https://v3.fal.media/files/panda/secret-output.mp4'

type Call = {
  readonly url: string
  readonly method: string
  readonly init: RequestInit
  /** 送った本文。`RequestInit['body']` はストリームも取りうるので、文字列だけ控える。 */
  readonly body: string
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const createFetch = (handler: Handler): { calls: Call[]; fetch: FalFetch } => {
  const calls: Call[] = []
  const fetch: FalFetch = (url, init) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      init,
      body: typeof init.body === 'string' ? init.body : '',
    })
    return Promise.resolve(handler(url, init))
  }
  return { calls, fetch }
}

const SUBMIT_BODY = {
  request_id: REQUEST_ID,
  response_url: `${ENDPOINT}/requests/${REQUEST_ID}`,
  status_url: `${ENDPOINT}/requests/${REQUEST_ID}/status`,
  cancel_url: `${ENDPOINT}/requests/${REQUEST_ID}/cancel`,
  queue_position: 2,
}

const RESULT_BODY = {
  video: {
    url: OUTPUT_URL,
    content_type: 'video/mp4',
    file_name: 'output.mp4',
    file_size: 1_234_567,
  },
  seed: 987,
}

const resolveReference = (id: MediaAssetId): Promise<string> =>
  Promise.resolve(`${SIGNED_REFERENCE_URL}&id=${id}`)

const makeProvider = (fetch: FalFetch): VideoProvider =>
  createFalVideoProvider({ apiKey: API_KEY, fetch })

const submitRequest = (spec: ShotGenerationSpec, model: VideoModelDescriptor = MODEL) => ({
  model,
  spec,
  resolveReference,
})

/** 投入だけ済ませてハンドルを得る。以降のポーリングは呼び出し側が差し替える。 */
const submitted = async (handler: Handler = () => jsonResponse(200, SUBMIT_BODY)) => {
  const { calls, fetch } = createFetch(handler)
  const provider = makeProvider(fetch)
  const handle = await provider.submit(submitRequest(makeSpec()))
  return { provider, handle, calls }
}

/** 文字列のどこにも URL が現れないこと。 */
const containsUrl = (text: string): boolean =>
  text.includes('http') || text.includes('://') || text.includes('fal.media')

describe('submit', () => {
  it('Queue API へ投入し、request_id をハンドルに持つ', async () => {
    const { handle, calls } = await submitted()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(ENDPOINT)
    expect(calls[0]?.url).toContain(EXPECTED_PATH)
    expect(calls[0]?.method).toBe('POST')
    expect(decodeFalJobRef(handle.ref).requestId).toBe(REQUEST_ID)
    expect(handle.providerId).toBe(MODEL.providerId)
    expect(handle.modelId).toBe(MODEL.id)
  })

  it('API キーはヘッダで渡す（本文にもクエリにも載せない）', async () => {
    const { calls } = await submitted()
    const headers = calls[0]?.init.headers as Record<string, string>

    expect(headers.Authorization).toBe(`Key ${API_KEY}`)
    expect(calls[0]?.url).not.toContain(API_KEY)
    expect(calls[0]?.body ?? '').not.toContain(API_KEY)
  })

  it('参照は image_urls として並び順のまま渡す', async () => {
    const { calls, fetch } = createFetch(() => jsonResponse(200, SUBMIT_BODY))
    await makeProvider(fetch).submit(
      submitRequest(
        makeSpec({
          references: [
            { mediaAssetId: 'asset-1' as MediaAssetId, role: 'subject', weight: 1 },
            { mediaAssetId: 'asset-2' as MediaAssetId, role: 'wardrobe', weight: 1 },
          ],
        }),
      ),
    )

    const body = JSON.parse(calls[0]?.body ?? '') as {
      image_urls: string[]
      task: string
      codec: string
    }
    expect(body.image_urls).toHaveLength(2)
    expect(body.image_urls[0]).toContain('asset-1')
    expect(body.image_urls[1]).toContain('asset-2')
    // 2.5 で増えた軸も実際に載っていること。
    expect(body.task).toBe('reference')
    expect(body.codec).toBe('H264')
  })

  it('モデルが出せない尺は投入前に弾く（2.5 の上限は 30 秒）', async () => {
    const { fetch, calls } = createFetch(() => jsonResponse(200, SUBMIT_BODY))
    await expect(
      makeProvider(fetch).submit(submitRequest(makeSpec({ durationSec: 31 }))),
    ).rejects.toBeInstanceOf(CapabilityViolationError)
    expect(calls).toHaveLength(0)
  })

  it('30 秒ちょうどは投入できる', async () => {
    const { fetch, calls } = createFetch(() => jsonResponse(200, SUBMIT_BODY))
    await makeProvider(fetch).submit(submitRequest(makeSpec({ durationSec: 30 })))
    const body = JSON.parse(calls[0]?.body ?? '') as { duration: number }
    expect(body.duration).toBe(30)
  })

  const manyReferences = (count: number) =>
    Array.from({ length: count }, (_unused, i) => ({
      mediaAssetId: `asset-${String(i)}` as MediaAssetId,
      role: 'subject' as const,
      weight: 1,
    }))

  it('参照 30 枚までは投入できる（2.5 で 9 → 30 に増えた）', async () => {
    const { fetch, calls } = createFetch(() => jsonResponse(200, SUBMIT_BODY))
    await makeProvider(fetch).submit(submitRequest(makeSpec({ references: manyReferences(30) })))
    const body = JSON.parse(calls[0]?.body ?? '') as { image_urls: string[] }
    expect(body.image_urls).toHaveLength(30)
  })

  /** 上限を超えた要求に金を払わない。投入前に弾き、HTTP を 1 回も叩かない。 */
  it('参照が 31 枚なら投入前に弾く', async () => {
    const { fetch, calls } = createFetch(() => jsonResponse(200, SUBMIT_BODY))
    await expect(
      makeProvider(fetch).submit(submitRequest(makeSpec({ references: manyReferences(31) }))),
    ).rejects.toBeInstanceOf(CapabilityViolationError)
    expect(calls).toHaveLength(0)
  })

  it('知らないモデルは扱わない', async () => {
    const { fetch } = createFetch(() => jsonResponse(200, SUBMIT_BODY))
    const other: VideoModelDescriptor = {
      ...MODEL,
      id: 'fal/unknown' as VideoModelDescriptor['id'],
    }
    await expect(
      makeProvider(fetch).submit(submitRequest(makeSpec(), other)),
    ).rejects.toBeInstanceOf(ProviderError)
  })

  it('応答の形が違えば握り潰さず失敗する', async () => {
    const { fetch } = createFetch(() => jsonResponse(200, { queue_position: 1 }))
    await expect(makeProvider(fetch).submit(submitRequest(makeSpec()))).rejects.toThrow(/応答/)
  })
})

describe('HTTP の失敗の切り分け', () => {
  const cases: readonly { status: number; retryable: boolean }[] = [
    { status: 401, retryable: false },
    { status: 403, retryable: false },
    { status: 422, retryable: false },
    { status: 429, retryable: true },
    { status: 500, retryable: true },
    { status: 503, retryable: true },
  ]

  for (const { status, retryable } of cases) {
    it(`${String(status)} は retryable=${String(retryable)}`, async () => {
      const { fetch } = createFetch(() => jsonResponse(status, { detail: 'nope' }))
      const error = await makeProvider(fetch)
        .submit(submitRequest(makeSpec()))
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ProviderError)
      expect((error as ProviderError).retryable).toBe(retryable)
    })
  }

  it('接続そのものが失敗したら retryable', async () => {
    const fetch: FalFetch = () => Promise.reject(new Error('ECONNRESET'))
    const error = await makeProvider(fetch)
      .submit(submitRequest(makeSpec()))
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).retryable).toBe(true)
  })
})

describe('poll', () => {
  const pollWith = async (
    statusBody: unknown,
    resultBody: unknown = RESULT_BODY,
  ): Promise<ProviderJobStatus> => {
    const { handle } = await submitted()
    const { fetch } = createFetch((url) =>
      url.endsWith('/status') ? jsonResponse(200, statusBody) : jsonResponse(200, resultBody),
    )
    // 投入とポーリングで fetch を替えるため、同じハンドルで新しい Provider を使う。
    return makeProvider(fetch).poll(handle)
  }

  it('IN_QUEUE は pending', async () => {
    await expect(pollWith({ status: 'IN_QUEUE', queue_position: 3 })).resolves.toEqual({
      state: 'pending',
      progress: null,
    })
  })

  it('IN_PROGRESS は running', async () => {
    await expect(pollWith({ status: 'IN_PROGRESS', logs: [] })).resolves.toEqual({
      state: 'running',
      progress: null,
    })
  })

  it('COMPLETED は結果を取りに行って succeeded になる', async () => {
    const status = await pollWith({ status: 'COMPLETED', metrics: { inference_time: 42.5 } })

    expect(status.state).toBe('succeeded')
    if (status.state !== 'succeeded') return
    expect(status.output).toEqual({ type: 'remote', url: OUTPUT_URL })
    expect(status.seedUsed).toBe(987)
  })

  it('costUsd は 生成尺 × 単価（応答には入っていない）', async () => {
    const status = await pollWith({ status: 'COMPLETED' })

    expect(status.state).toBe('succeeded')
    if (status.state !== 'succeeded') return
    // 定数どうしで突き合わせると単価の取り違えを見逃すので、実数で留める。
    expect(status.costUsd).toBeCloseTo(4 * 0.3024, 10)
    expect(status.costUsd).toBeCloseTo(4 * FAL_SEEDANCE_COST_PER_SECOND_USD, 10)
  })

  it('失敗応答は理由つきで failed になる', async () => {
    const status = await pollWith({
      status: 'COMPLETED',
      error: '入力画像を読み込めませんでした',
      error_type: 'InvalidInput',
    })

    expect(status.state).toBe('failed')
    if (status.state !== 'failed') return
    expect(status.error.message.length).toBeGreaterThan(0)
    expect(status.error.message).toContain('入力画像')
    expect(status.error.code).toContain('InvalidInput')
    expect(status.error.retryable).toBe(false)
  })

  it('知らない status は pending へ丸めず失敗させる', async () => {
    const status = await pollWith({ status: 'ASCENDED' })

    expect(status.state).toBe('failed')
    if (status.state !== 'failed') return
    expect(status.error.code).toBe('fal_invalid_response')
  })

  it('結果の形が違えば握り潰さず失敗する', async () => {
    const status = await pollWith({ status: 'COMPLETED' }, { seed: 1 })

    expect(status.state).toBe('failed')
    if (status.state !== 'failed') return
    expect(status.error.code).toBe('fal_invalid_response')
  })

  it('ポーリング中の 5xx は retryable な失敗、4xx はそうでない', async () => {
    const { handle } = await submitted()
    const failing = (httpStatus: number): Promise<unknown> => {
      const { fetch } = createFetch(() => jsonResponse(httpStatus, { detail: 'nope' }))
      return makeProvider(fetch).poll(handle)
    }

    const server = await failing(503)
    const auth = await failing(401)

    expect(server).toMatchObject({ state: 'failed', error: { retryable: true } })
    expect(auth).toMatchObject({ state: 'failed', error: { retryable: false } })
  })
})

describe('署名付き URL を外へ出さない', () => {
  it('raw に出力 URL も参照 URL も入れない', async () => {
    const { calls, fetch } = createFetch(() => jsonResponse(200, SUBMIT_BODY))
    const provider = makeProvider(fetch)
    const handle = await provider.submit(
      submitRequest(
        makeSpec({
          references: [{ mediaAssetId: 'asset-1' as MediaAssetId, role: 'subject', weight: 1 }],
        }),
      ),
    )
    expect(calls[0]?.body ?? '').toContain('X-Amz-Signature')

    const polled = createFetch((url) =>
      url.endsWith('/status')
        ? jsonResponse(200, { status: 'COMPLETED' })
        : jsonResponse(200, RESULT_BODY),
    )
    const status = await makeProvider(polled.fetch).poll(handle)

    expect(status.state).toBe('succeeded')
    if (status.state !== 'succeeded') return
    expect(containsUrl(JSON.stringify(status.raw))).toBe(false)
    expect(JSON.stringify(status.raw)).not.toContain('X-Amz-Signature')
  })

  it('例外のメッセージに URL を混ぜない', async () => {
    const { fetch } = createFetch(() => jsonResponse(500, { detail: `取得に失敗: ${OUTPUT_URL}` }))
    const error = await makeProvider(fetch)
      .submit(submitRequest(makeSpec()))
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect(containsUrl((error as Error).message)).toBe(false)
    expect((error as Error).message).not.toContain('secret-output')
  })

  it('失敗の理由に URL が混ざっていても外へ出さない', async () => {
    const { handle } = await submitted()
    const { fetch } = createFetch(() =>
      jsonResponse(200, {
        status: 'COMPLETED',
        error: `参照 ${SIGNED_REFERENCE_URL} を読めません`,
        error_type: 'InvalidInput',
      }),
    )
    const status = await makeProvider(fetch).poll(handle)

    expect(status.state).toBe('failed')
    if (status.state !== 'failed') return
    expect(containsUrl(status.error.message)).toBe(false)
    expect(status.error.message).not.toContain('X-Amz-Signature')
    expect(status.error.message.length).toBeGreaterThan(0)
  })
})

describe('cancel', () => {
  const cancelWith = async (status: number, body: unknown): Promise<Call[]> => {
    const { handle } = await submitted()
    const { calls, fetch } = createFetch(() => jsonResponse(status, body))
    await makeProvider(fetch).cancel(handle)
    return calls
  }

  it('202 CANCELLATION_REQUESTED は正常', async () => {
    const calls = await cancelWith(202, { status: 'CANCELLATION_REQUESTED' })
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe(`${ENDPOINT}/requests/${REQUEST_ID}/cancel`)
  })

  it('400 ALREADY_COMPLETED は例外にしない', async () => {
    await expect(cancelWith(400, { status: 'ALREADY_COMPLETED' })).resolves.toHaveLength(1)
  })

  it('404 NOT_FOUND は例外にしない', async () => {
    await expect(cancelWith(404, { status: 'NOT_FOUND' })).resolves.toHaveLength(1)
  })

  it('それ以外の失敗は握り潰さない', async () => {
    const { handle } = await submitted()
    const { fetch } = createFetch(() => jsonResponse(500, { detail: 'boom' }))
    await expect(makeProvider(fetch).cancel(handle)).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('設定', () => {
  it('API キーが空なら作らせない', () => {
    const { fetch } = createFetch(() => jsonResponse(200, SUBMIT_BODY))
    expect(() => createFalVideoProvider({ apiKey: '', fetch })).toThrow()
  })

  it('shotId は要求に載せない（監査は raw と Take が持つ）', async () => {
    const { calls } = await submitted()
    expect(calls[0]?.body ?? '').not.toContain(SHOT_ID_A)
  })
})
