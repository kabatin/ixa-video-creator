import { describe, expect, it } from 'vitest'
import { checkLocalServerHealth } from '../local-server/health-check.js'
import { VPIPE_IDENTITY } from '../vpipe/descriptor.js'
import {
  BASE_URL,
  connectionRefused,
  connectionReset,
  createFetch,
  HEALTH_URL,
  healthBody,
  jsonResponse,
  TOKEN,
} from './vpipe-fixtures.js'

/**
 * 「使う AI」の一覧で、手元の生成サーバが起動しているかを見る（ADR-0032）。
 * **何も積まない**（`GET /v1/health` だけ）。起動していないときは、起こし方まで言う。
 */
describe('checkLocalServerHealth（vpipe）', () => {
  it('health が答えれば起動している（版も拾う）', async () => {
    const { fetch, calls } = createFetch(() => jsonResponse(200, healthBody()))

    expect(await checkLocalServerHealth({ identity: VPIPE_IDENTITY, baseUrl: BASE_URL, token: null, fetch })).toEqual({
      state: 'up',
      version: '0.1.0',
    })
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`GET ${HEALTH_URL}`])
  })

  it('合言葉があればヘッダで送る', async () => {
    const { fetch, calls } = createFetch(() => jsonResponse(200, healthBody()))

    await checkLocalServerHealth({ identity: VPIPE_IDENTITY, baseUrl: BASE_URL, token: TOKEN, fetch })

    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('接続を拒まれたら「起動していません」と言い、起こし方を添える', async () => {
    const result = await checkLocalServerHealth({
      identity: VPIPE_IDENTITY,
      baseUrl: BASE_URL,
      token: null,
      fetch: () => connectionRefused(),
    })

    expect(result.state).toBe('down')
    if (result.state === 'down') expect(result.reason).toMatch(/起動していません.*vpipe-api serve/)
  })

  it('途中で切れた・時間切れは「応答がありません」（起動していないとは言い切らない）', async () => {
    const result = await checkLocalServerHealth({
      identity: VPIPE_IDENTITY,
      baseUrl: BASE_URL,
      token: null,
      fetch: () => connectionReset(),
    })

    expect(result).toEqual({
      state: 'down',
      reason: expect.stringMatching(/応答がありません/) as unknown,
    })
  })

  it('合言葉が合わなければそう言う', async () => {
    const { fetch } = createFetch(() =>
      jsonResponse(401, {
        error: { code: 'unauthorized', message: 'x', retryable: false, details: null },
      }),
    )

    const result = await checkLocalServerHealth({ identity: VPIPE_IDENTITY, baseUrl: BASE_URL, token: 'wrong-token', fetch })

    expect(result).toEqual({
      state: 'down',
      reason: expect.stringMatching(/VPIPE_API_TOKEN/) as unknown,
    })
  })

  it('vpipe-api ではない何かが答えたら使えない扱い', async () => {
    const { fetch } = createFetch(() => jsonResponse(200, { hello: 'world' }))

    expect((await checkLocalServerHealth({ identity: VPIPE_IDENTITY, baseUrl: BASE_URL, token: null, fetch })).state).toBe('down')
  })
})
