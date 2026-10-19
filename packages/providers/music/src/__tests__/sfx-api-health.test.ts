import type { LocalServerFetch } from '@ixa/provider-video'
import { describe, expect, it, vi } from 'vitest'
import { checkSfxApiHealth } from '../sfx-api/health.js'

/** sfx-api の health（ADR-0052）。workflow ごとに使えるかを見る。**実サーバは叩かない。** */

const BASE_URL = 'http://sfx.test:8769'
const health = (workflows: Record<string, unknown> | undefined) => ({
  status: 'ok',
  version: '0.1.0',
  running: 0,
  waiting: 0,
  max_waiting: 8,
  ...(workflows === undefined ? {} : { workflows }),
})
const serve = (body: unknown) =>
  vi.fn<LocalServerFetch>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })),
  )

describe('checkSfxApiHealth', () => {
  const workflows = {
    'stable-audio-3-sfx': { available: true, loaded: false, reason: null },
    'moss-sfx-v2': { available: false, loaded: false, reason: 'weights not found at /Users/x/moss' },
  }

  it('待機中（available・まだ読み込んでいない）はふつうに使える', async () => {
    const result = await checkSfxApiHealth({ baseUrl: BASE_URL, token: null, workflowId: 'stable-audio-3-sfx', fetch: serve(health(workflows)) })
    expect(result).toEqual({ state: 'up', version: '0.1.0' })
  })

  it('使えない workflow は理由つきで使えない（置き場所は出さない）', async () => {
    const result = await checkSfxApiHealth({ baseUrl: BASE_URL, token: null, workflowId: 'moss-sfx-v2', fetch: serve(health(workflows)) })
    expect(result.state).toBe('down')
    expect(result.state === 'down' ? result.reason : '').toMatch(/MOSS SFX v2（手元）は今使えません/)
    expect(JSON.stringify(result)).not.toContain('/Users/x')
  })

  it('曲の workflow（歌なし BGM）も同じ一覧で見て、使えなければ曲のモデルの名前で言う', async () => {
    const music = { 'stable-audio-3-medium-music': { available: false, loaded: false, reason: 'weights not found' } }
    const result = await checkSfxApiHealth({
      baseUrl: BASE_URL,
      token: null,
      workflowId: 'stable-audio-3-medium-music',
      fetch: serve(health(music)),
    })
    expect(result.state === 'down' ? result.reason : '').toMatch(/^Stable Audio 3 Medium（歌なし・手元）は今使えません/)
  })

  it('一覧に無い workflow は使えない。一覧を返さない古いサーバは応答していれば使える', async () => {
    const missing = await checkSfxApiHealth({ baseUrl: BASE_URL, token: null, workflowId: 'moss-sfx-v2', fetch: serve(health({})) })
    expect(missing.state).toBe('down')
    const old = await checkSfxApiHealth({ baseUrl: BASE_URL, token: null, workflowId: 'moss-sfx-v2', fetch: serve(health(undefined)) })
    expect(old.state).toBe('up')
  })

  it('叩くのは 1 回だけ', async () => {
    const fetchMock = serve(health(workflows))
    await checkSfxApiHealth({ baseUrl: BASE_URL, token: null, workflowId: 'stable-audio-3-sfx', fetch: fetchMock })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('workflow の一覧の形が違えば、全部使えるようには見せない', async () => {
    const broken = health({ 'stable-audio-3-sfx': { available: 'yes' } })
    const result = await checkSfxApiHealth({ baseUrl: BASE_URL, token: null, workflowId: 'stable-audio-3-sfx', fetch: serve(broken) })
    expect(result.state).toBe('down')
  })

  it('合言葉が合わなければそう言う', async () => {
    const denied = vi.fn<LocalServerFetch>(() => Promise.resolve(new Response('{}', { status: 401 })))
    expect(await checkSfxApiHealth({ baseUrl: BASE_URL, token: 'x'.repeat(40), workflowId: 'moss-sfx-v2', fetch: denied })).toEqual({
      state: 'down',
      reason: '合言葉（SFX_API_TOKEN）が合いません',
    })
  })

  it('サーバが止まっていれば起こし方を言う', async () => {
    const refused = vi.fn<LocalServerFetch>(() => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })))
    const result = await checkSfxApiHealth({ baseUrl: BASE_URL, token: null, workflowId: 'stable-audio-3-sfx', fetch: refused })
    expect(result).toEqual({ state: 'down', reason: '起動していません（sfx-api を起動してください）' })
  })
})
