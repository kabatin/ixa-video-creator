import type { MediaAssetId, ShotGenerationSpec } from '@ixa/domain'
import { ProviderBusyError, ProviderError, type VideoGenerationRequest } from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createVpipeVideoProvider } from '../vpipe/provider.js'
import { LOCAL_SERVER_FULL_RETRY_AFTER_MS } from '../local-server/submit.js'
import { createTempDir, makeSpec, removeTempDir } from './fixtures.js'
import {
  BASE_URL,
  bytesResponse,
  connectionRefused,
  connectionReset,
  connectTimeout,
  createFetch,
  errorEnvelope,
  healthBody,
  HEALTH_URL,
  JOB_ID,
  jsonResponse,
  makeVpipeProvider,
  serverRoutes,
  SIGNED_URL_PREFIX,
  stallingResponse,
  submitCallOf,
  SUBMIT_BODY,
  SUBMIT_URL,
  truncatedResponse,
  vpipeRequestFor,
  type Handler,
} from './vpipe-fixtures.js'

let outputDir = ''
beforeEach(async () => {
  outputDir = await createTempDir()
})
afterEach(async () => {
  await removeTempDir(outputDir)
})

/** worker は GenerationJob の ID（ULID）を冪等キーにする。 */
const KEY = '01J9ZK3N2Q8V7W6X5Y4Z3A2B1C'

const withStartFrame = (overrides: Partial<ShotGenerationSpec> = {}): ShotGenerationSpec =>
  makeSpec({
    resolution: { width: 1920, height: 1080 },
    references: [{ mediaAssetId: 'asset-1' as MediaAssetId, role: 'start_frame', weight: 1 }],
    ...overrides,
  })

/** null は「キーなし」。 */
const keyed = (idempotencyKey: string | null = KEY): VideoGenerationRequest => ({
  ...vpipeRequestFor(withStartFrame()),
  ...(idempotencyKey === null ? {} : { idempotencyKey }),
})

const submitWith = async (handler: Handler, request: VideoGenerationRequest = keyed()) => {
  const { calls, fetch } = createFetch(handler)
  const result = await makeVpipeProvider(fetch, outputDir)
    .submit(request)
    .catch((error: unknown) => error)
  return { calls, result }
}

describe('投入の前に空きを確かめる（満杯なら画像を取り寄せない）', () => {
  it('満杯なら開始画像も投入も試さず ProviderBusyError（待ちの目安つき）', async () => {
    const { calls, result } = await submitWith(
      serverRoutes({
        health: () => jsonResponse(200, healthBody(1, 1, 1)),
        submit: () => jsonResponse(202, SUBMIT_BODY),
      }),
    )
    expect(result).toBeInstanceOf(ProviderBusyError)
    expect((result as ProviderBusyError).retryAfterMs).toBe(LOCAL_SERVER_FULL_RETRY_AFTER_MS)
    expect(calls.map((c) => c.url)).toEqual([HEALTH_URL])
  })

  it('待ちの枠が空いていれば投入する', async () => {
    const { calls, result } = await submitWith(
      serverRoutes({
        health: () => jsonResponse(200, healthBody(1, 0, 1)),
        submit: () => jsonResponse(202, SUBMIT_BODY),
      }),
    )
    expect(result).toMatchObject({ ref: JOB_ID })
    expect(calls.some((c) => c.url.startsWith(SIGNED_URL_PREFIX))).toBe(true)
    expect(submitCallOf(calls)).toBeDefined()
  })

  it('確認の応答が読めなければ確かめずに進む（本当の門番は投入の 429）', async () => {
    for (const health of [() => jsonResponse(404, {}), () => jsonResponse(200, { status: 'ok' })]) {
      const { result } = await submitWith(
        serverRoutes({ health, submit: () => jsonResponse(202, SUBMIT_BODY) }),
      )
      expect(result).toMatchObject({ ref: JOB_ID })
    }
  })

  it('確認に応答が返らなければ、何も積まずに後で試す（ProviderBusyError）', async () => {
    const { calls, result } = await submitWith(
      serverRoutes({
        health: () => connectionReset(),
        submit: () => jsonResponse(202, SUBMIT_BODY),
      }),
    )
    expect(result).toBeInstanceOf(ProviderBusyError)
    expect(submitCallOf(calls)).toBeUndefined()
  })
})

describe('冪等キー（応答が失われた投入を二重に生成しない）', () => {
  it('GenerationJob の ID を Idempotency-Key ヘッダで送る（本文には載せない）', async () => {
    const { calls } = await submitWith(
      serverRoutes({ submit: () => jsonResponse(202, SUBMIT_BODY) }),
    )
    expect(submitCallOf(calls)?.headers['Idempotency-Key']).toBe(KEY)
    expect(submitCallOf(calls)?.body).not.toContain(KEY)
  })

  it('キーが無ければヘッダを付けない', async () => {
    const { calls } = await submitWith(
      serverRoutes({ submit: () => jsonResponse(202, SUBMIT_BODY) }),
      keyed(null),
    )
    expect(submitCallOf(calls)?.headers['Idempotency-Key']).toBeUndefined()
  })

  it('同じキーの既存ジョブ（200）も 202 と同じく受け取る', async () => {
    const { result } = await submitWith(
      serverRoutes({ submit: () => jsonResponse(200, { ...SUBMIT_BODY, status: 'running' }) }),
    )
    expect(result).toMatchObject({ ref: JOB_ID })
  })

  it('形の違うキーは送らずに落とす（配線の誤り）', async () => {
    const { calls, result } = await submitWith(
      serverRoutes({ submit: () => jsonResponse(202, SUBMIT_BODY) }),
      keyed('../bad key'),
    )
    expect(result).toBeInstanceOf(ProviderError)
    expect((result as ProviderError).retryable).toBe(false)
    expect(calls).toHaveLength(0)
  })

  const ambiguous: readonly { name: string; submit: () => Response | Promise<Response> }[] = [
    { name: '送ったあとで接続が切れた', submit: () => connectionReset() },
    { name: '応答の本文が途中で切れた（サーバの再起動）', submit: () => truncatedResponse(202) },
  ]
  for (const { name, submit } of ambiguous) {
    it(`${name}: キーがあれば失敗と決めつけず ProviderBusyError（同じキーで投げ直す）`, async () => {
      const { result } = await submitWith(serverRoutes({ submit }))
      expect(result).toBeInstanceOf(ProviderBusyError)
      expect((result as ProviderBusyError).retryable).toBe(true)
    })

    it(`${name}: キーが無ければ ProviderBusyError にしない（投げ直すと二重に生成しうる）`, async () => {
      const { result } = await submitWith(serverRoutes({ submit }), keyed(null))
      expect(result).toBeInstanceOf(ProviderError)
      expect(result).not.toBeInstanceOf(ProviderBusyError)
    })
  }

  it('接続を拒まれた（届いていない）投入は、キーがあってもそのまま失敗として知らせる', async () => {
    const { result } = await submitWith(serverRoutes({ submit: () => connectionRefused() }))
    expect(result).toMatchObject({ code: 'vpipe_unreachable', retryable: true })
    expect(result).not.toBeInstanceOf(ProviderBusyError)
  })

  it('同じキーで中身が違う（409 idempotency_conflict）はやり直せない失敗', async () => {
    const { result } = await submitWith(
      serverRoutes({
        submit: () => jsonResponse(409, errorEnvelope('idempotency_conflict', false)),
      }),
    )
    expect(result).toMatchObject({ code: 'vpipe_idempotency_conflict', retryable: false })
    expect(result).not.toBeInstanceOf(ProviderBusyError)
  })

  /** vpipe-api 7a05f82: 同じキーの投入がまだ処理中なら 409 idempotency_in_flight（retryable）。 */
  it('同じキーの投入がまだ処理中（409 idempotency_in_flight）なら、後で同じ投入をやり直す', async () => {
    const inFlight = serverRoutes({
      submit: () => jsonResponse(409, errorEnvelope('idempotency_in_flight', true)),
    })
    const withKey = await submitWith(inFlight)
    expect(withKey.result).toBeInstanceOf(ProviderBusyError)

    const withoutKey = await submitWith(inFlight, keyed(null))
    expect(withoutKey.result).not.toBeInstanceOf(ProviderBusyError)
    expect(withoutKey.result).toMatchObject({ code: 'vpipe_idempotency_in_flight' })
  })

  it('5xx でもサーバがやり直せないと言うなら、投げ直さず終端にする', async () => {
    const { result } = await submitWith(
      serverRoutes({ submit: () => jsonResponse(500, errorEnvelope('internal', false)) }),
    )
    expect(result).not.toBeInstanceOf(ProviderBusyError)
    expect((result as ProviderError).retryable).toBe(false)
  })
})

describe('開始画像の大きさ（丸ごと読んでから確かめない）', () => {
  const TWENTY_MB = 20 * 1024 * 1024

  it('Content-Length が 20MB を超えると申告したら、読まずに断る', async () => {
    const { calls, result } = await submitWith(
      serverRoutes({
        submit: () => jsonResponse(202, SUBMIT_BODY),
        image: () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'image/png', 'content-length': String(TWENTY_MB + 1) },
          }),
      }),
    )
    expect(result).toBeInstanceOf(ProviderError)
    expect((result as Error).message).toContain('大きすぎます')
    expect(submitCallOf(calls)).toBeUndefined()
  })

  it('申告が無くても、読みながら 20MB を超えた時点で止める', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1
        controller.enqueue(chunk)
      },
    })
    const { calls, result } = await submitWith(
      serverRoutes({
        submit: () => jsonResponse(202, SUBMIT_BODY),
        image: () => new Response(endless, { headers: { 'content-type': 'image/png' } }),
      }),
    )
    expect((result as Error).message).toContain('大きすぎます')
    expect((result as ProviderError).retryable).toBe(false)
    // 上限を少し超えたところで止まり、終わりの無い本文を読み続けない。
    expect(sent).toBeLessThan(25)
    expect(submitCallOf(calls)).toBeUndefined()
  })

  it('空の画像は送らない', async () => {
    const { result } = await submitWith(
      serverRoutes({
        submit: () => jsonResponse(202, SUBMIT_BODY),
        image: () => bytesResponse(new Uint8Array(), 'image/png'),
      }),
    )
    expect((result as Error).message).toContain('空')
  })
})

describe('投入の URL', () => {
  it('ワークフローの口へ POST する', async () => {
    const { calls } = await submitWith(
      serverRoutes({ submit: () => jsonResponse(202, SUBMIT_BODY) }),
    )
    expect(submitCallOf(calls)?.url).toBe(SUBMIT_URL)
  })
})

/**
 * サーバのエラー（5xx）は満杯ではない（PR #4 レビュー #1）。
 * 以前は満杯と同じ扱いで、60 秒ごとに 27MB を送り直しながら最大 12 時間回り、
 * 最後に「順番が回ってこなかった」と誤った理由を出していた。
 */
describe('サーバのエラー（5xx）', () => {
  const failing = (count: number) => {
    let seen = 0
    return serverRoutes({
      submit: () => {
        seen += 1
        return seen <= count
          ? jsonResponse(500, errorEnvelope('internal', true, 'GPU の初期化に失敗しました'))
          : jsonResponse(202, SUBMIT_BODY)
      },
    })
  }

  it('鍵があれば 3 回まで投げ直し、続けばサーバの理由で失敗にする（満杯として待たない）', async () => {
    const { calls, result } = await submitWith(failing(Number.POSITIVE_INFINITY))
    expect(result).toBeInstanceOf(ProviderError)
    expect(result).not.toBeInstanceOf(ProviderBusyError)
    expect((result as ProviderError).message).toContain('GPU の初期化に失敗しました')
    expect(calls.filter((call) => call.url === SUBMIT_URL)).toHaveLength(3)
  })

  it('1 回だけなら、すぐ投げ直して通る', async () => {
    const { calls, result } = await submitWith(failing(1))
    expect(result).toMatchObject({ ref: JOB_ID })
    expect(calls.filter((call) => call.url === SUBMIT_URL)).toHaveLength(2)
  })

  it('鍵が無ければ投げ直さない（二重に生成しうる）', async () => {
    const { calls, result } = await submitWith(failing(Number.POSITIVE_INFINITY), keyed(null))
    expect(result).not.toBeInstanceOf(ProviderBusyError)
    expect(calls.filter((call) => call.url === SUBMIT_URL)).toHaveLength(1)
  })
})

/** 別の Mac が眠っているとき（PR #4 レビュー #2・#3）。 */
describe('vpipe へ届かない・答えない', () => {
  it('接続の時間切れは「届いていない」。待たずにすぐ失敗にする', async () => {
    const { result } = await submitWith(
      serverRoutes({
        health: () => connectTimeout(),
        submit: () => jsonResponse(202, SUBMIT_BODY),
      }),
    )
    expect(result).toMatchObject({ code: 'vpipe_unreachable' })
    expect(result).not.toBeInstanceOf(ProviderBusyError)
  })

  it('空きの確認は短い時間で切り上げる（止まった vpipe で他の生成を待たせない）', async () => {
    const { fetch } = createFetch(
      serverRoutes({
        health: (_url, init) => stallingResponse(init, 'application/json'),
        submit: () => jsonResponse(202, SUBMIT_BODY),
      }),
    )
    const provider = createVpipeVideoProvider({
      baseUrl: BASE_URL,
      outputDir,
      fetch,
      // 1 回の HTTP の上限は長いまま。確認だけが短く切れることを見る。
      timeoutMs: 60_000,
      healthTimeoutMs: 20,
    })
    const result = await provider.submit(keyed()).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(ProviderBusyError)
  })
})

/** PR #4 レビュー #6。合言葉が S3 / MinIO へ漏れないこと。 */
describe('合言葉（Bearer）', () => {
  it('vpipe にだけ送り、開始画像（署名付き URL）の取得には載せない', async () => {
    const { calls, fetch } = createFetch(
      serverRoutes({ submit: () => jsonResponse(202, SUBMIT_BODY) }),
    )
    await makeVpipeProvider(fetch, outputDir, 'vpipe-secret').submit(keyed())

    const image = calls.find((call) => call.url.startsWith(SIGNED_URL_PREFIX))
    expect(image).toBeDefined()
    expect(JSON.stringify(image?.headers ?? {})).not.toContain('vpipe-secret')
    expect(submitCallOf(calls)?.headers['Authorization']).toBe('Bearer vpipe-secret')
  })
})

