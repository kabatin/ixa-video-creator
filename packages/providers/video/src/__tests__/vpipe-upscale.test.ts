import { ProviderBusyError } from '@ixa/provider-core'
import { describe, expect, it, vi } from 'vitest'
import type { LocalServerFetch, LocalServerHttp } from '../local-server/http.js'
import { VPIPE_IDENTITY } from '../vpipe/descriptor.js'
import {
  FLASHVSR_WORKFLOW_ID,
  createVpipeUpscaler,
  flashvsrEstimateSec,
} from '../vpipe/upscale.js'
import { errorEnvelope, jsonResponse } from './local-server-fixtures.js'

/**
 * 解像度を上げる口の契約（ADR-0044）。**実サーバは叩かない。**
 *
 * 見たいのは、生成の口と同じ作法（冪等キー・429・応答の形）を守ることと、
 * **`output` を必ず明示して送ること**（サーバの既定に頼ると、版が変わったとき黙って違う大きさで返る）。
 */

const BASE_URL = 'http://vpipe.test:8765'
const VIDEO = { data: 'AAAA', mediaType: 'video/mp4' } as const
const OUTPUT = { width: 1920, height: 1080 }
const KEY = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

/** 呼び出しの引数まで型が付く形にする（本文とヘッダを後から読むため）。 */
const mockFetch = (impl: LocalServerFetch) => vi.fn<LocalServerFetch>(impl)
type MockedFetch = ReturnType<typeof mockFetch>

const upscaler = (fetchImpl: MockedFetch) =>
  createVpipeUpscaler({
    http: {
      identity: VPIPE_IDENTITY,
      fetch: fetchImpl,
      baseUrl: BASE_URL,
      token: 'test-token',
      timeoutMs: 5_000,
    } satisfies LocalServerHttp,
    outputDir: '/tmp/ixa-test-not-used',
  })

const submitOk = (body: unknown = { id: 'job_1', estimate_seconds: 409 }) =>
  mockFetch(() => Promise.resolve(jsonResponse(202, body)))

const bodyOf = (fetchMock: MockedFetch): Record<string, unknown> => {
  const body = fetchMock.mock.calls[0]?.[1].body
  // 送っているのは JSON の文字列だけ。別の形なら、それ自体が不具合なので落とす
  if (typeof body !== 'string') throw new Error('本文が文字列ではありません')
  return JSON.parse(body) as Record<string, unknown>
}

const submit = (fetchMock: MockedFetch) =>
  upscaler(fetchMock).submit({ video: VIDEO, output: OUTPUT, idempotencyKey: KEY })

describe('対応しているかはサーバに訊く', () => {
  it('ワークフローの一覧に出ていれば対応している', async () => {
    const list = { workflows: [{ id: 'minimax-h3-turbo-video' }, { id: FLASHVSR_WORKFLOW_ID }] }
    expect(await upscaler(mockFetch(() => Promise.resolve(jsonResponse(200, list)))).available()).toBe(true)
  })

  /** 対応していない版へ投げると、大きな本文を送ってから断られる。押す前に分かる形にする。 */
  it('出ていなければ対応していない', async () => {
    const list = { workflows: [{ id: 'minimax-h3-turbo-video' }] }
    expect(await upscaler(mockFetch(() => Promise.resolve(jsonResponse(200, list)))).available()).toBe(false)
  })

  /** **つながらないときは「対応していない」に倒す。** 押せないほうが、押して失敗するより良い。 */
  it('つながらなければ対応していないとみなす', async () => {
    const fetchMock = mockFetch(() => Promise.reject(new Error('つながりません')))
    expect(await upscaler(fetchMock).available()).toBe(false)
  })
})

describe('投入', () => {
  it('動画と、出す大きさを必ず送る', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(jsonResponse(202, { id: 'job_1' })))
    await submit(fetchMock)

    const body = bodyOf(fetchMock)
    expect(body.source_video).toEqual({ data: 'AAAA', media_type: 'video/mp4' })
    // **サーバの既定に頼らない。** 省くと、版が変わったとき黙って違う大きさで返る
    expect(body.output).toEqual({ width: 1920, height: 1080 })
  })

  it('冪等キーを付ける（投げ直しても二重に作らせない）', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(jsonResponse(202, { id: 'job_1' })))
    await submit(fetchMock)

    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).get('Idempotency-Key')).toBe(KEY)
  })

  /** 走っている間の「あと何分」はこの値が正。 */
  it('サーバが返した見込みを持ち帰る', async () => {
    expect((await submit(submitOk())).estimateSeconds).toBe(409)
  })

  /** 古い版は返さない。**0 に倒さない**（0 秒で終わると出てしまう）。 */
  it('見込みを返さないサーバでは null', async () => {
    expect((await submit(submitOk({ id: 'job_1' }))).estimateSeconds).toBeNull()
  })

  /** 満杯は失敗にしない。worker は待って投げ直す（生成と同じ扱い）。 */
  it('満杯（429）は「混んでいる」として投げ返す', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(jsonResponse(429, errorEnvelope('busy', true), { 'retry-after': '45' })),
    )
    await expect(submit(fetchMock)).rejects.toBeInstanceOf(ProviderBusyError)
  })
})

/**
 * 押す前の下見の見込み。**「尺 × 係数」で出すと 2 倍外れる。**
 * FlashVSR は 25 コマの束から 21 コマしか返さないので、費用はグループ数で決まる。
 */
describe('見込みの式', () => {
  it('実測に合う（56 コマ=3 / 73 コマ=4 / 192 コマ=10 グループ）', () => {
    expect(flashvsrEstimateSec(56)).toBe(308)
    expect(flashvsrEstimateSec(73)).toBe(409)
    expect(flashvsrEstimateSec(192)).toBe(1015)
  })

  /** **21 を 1 枚超えただけで倍**になる。ここが線形との差。 */
  it('グループ単位で切り上がる', () => {
    expect(flashvsrEstimateSec(21)).toBe(106)
    expect(flashvsrEstimateSec(22)).toBe(207)
  })
})
