import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { AI_TOOLS } from '@ixa/domain'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProviderBusyError, ProviderError, type ProviderJobHandle, type SfxGenerationRequest } from '@ixa/provider-core'
import type { LocalServerFetch } from '@ixa/provider-video'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MOSS_SFX_MODEL_ID,
  SFX_API_DEFAULT_BASE_URL,
  SFX_API_PROVIDER_ID,
  STABLE_AUDIO_SFX_MODEL_ID,
  mossSfxModel,
  stableAudioSfxModel,
} from '../sfx-api/descriptor.js'
import { createSfxApiProvider } from '../sfx-api/provider.js'

/**
 * sfx-api の契約（ADR-0052 §1）。**実サーバは叩かない。**
 *
 * 見たいのは: モデルごとの workflow に、説明・入れたくない音・長さ・数・種を送る、冪等キーを付ける、
 * 429 を「混んでいる」にする、出来上がりを本数ぶん WAV で取り込み標本化周波数を運ぶ、欠けた成功を成功にしない。
 */

const BASE_URL = 'http://sfx.test:8769'
const TOKEN = 'b'.repeat(40)
const JOB_ID = 'job_01J9ZK3N2Q8V7W6X5Y4Z3A2B1D'
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])

const mockFetch = (impl: LocalServerFetch) => vi.fn<LocalServerFetch>(impl)
type MockedFetch = ReturnType<typeof mockFetch>

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-sfx-api-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const provider = (fetchMock: MockedFetch) =>
  createSfxApiProvider({ baseUrl: `${BASE_URL}/`, token: TOKEN, outputDir: join(dir, 'out'), fetch: fetchMock })

const request = (overrides: Partial<SfxGenerationRequest> = {}): SfxGenerationRequest => ({
  model: stableAudioSfxModel,
  prompt: 'cinematic impact hit',
  negativePrompt: null,
  durationSec: 1.5,
  seed: 42,
  count: 1,
  idempotencyKey: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  ...overrides,
})

const handle: ProviderJobHandle = {
  providerId: SFX_API_PROVIDER_ID,
  modelId: STABLE_AUDIO_SFX_MODEL_ID,
  ref: JOB_ID,
  submittedAt: new Date(),
}

const bodyOf = (fetchMock: MockedFetch): Record<string, unknown> => {
  const body = fetchMock.mock.calls[0]?.[1].body
  if (typeof body !== 'string') throw new Error('本文が文字列ではありません')
  return JSON.parse(body) as Record<string, unknown>
}

const job = (status: string, extra: Record<string, unknown> = {}) => ({
  id: JOB_ID,
  workflow: 'stable-audio-3-sfx',
  status,
  created_at: '2026-10-18T12:00:00Z',
  started_at: null,
  finished_at: null,
  ...extra,
})

/** サーバは i 本目に seed + 2i を使う（seed_used が正）。 */
const output = (index: number, durationSec = 1.5, sampleRate = 44_100, channels = 2) => ({
  index,
  media_type: 'audio/wav',
  duration_sec: durationSec,
  sample_rate: sampleRate,
  channels,
  seed_used: 42 + 2 * index,
})

describe('投入', () => {
  it('Stable Audio の workflow に説明・長さ・数・種を送り、合言葉と冪等キーを付ける', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    const result = await provider(fetchMock).submit(request({ count: 2 }))

    expect(result).toMatchObject({ providerId: SFX_API_PROVIDER_ID, modelId: STABLE_AUDIO_SFX_MODEL_ID, ref: JOB_ID })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/v1/workflows/stable-audio-3-sfx/jobs`)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('idempotency-key')).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV')
    expect(bodyOf(fetchMock)).toEqual({ prompt: 'cinematic impact hit', duration_sec: 1.5, count: 2, seed: 42 })
  })

  it('MOSS は moss-sfx-v2 に送る。入れたくない音を送り、種が無ければ seed を省く', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    const result = await provider(fetchMock).submit(request({ model: mossSfxModel, seed: null, negativePrompt: 'music, voice' }))
    expect(result.modelId).toBe(MOSS_SFX_MODEL_ID)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/v1/workflows/moss-sfx-v2/jobs`)
    const body = bodyOf(fetchMock)
    expect(body).toMatchObject({ negative_prompt: 'music, voice' })
    expect(body).not.toHaveProperty('seed')
  })

  it.each([
    ['説明が空', { prompt: '  ' }, /説明が空/],
    ['説明が長い', { prompt: 'a'.repeat(501) }, /500 文字/],
    ['入れたくない音が長い', { negativePrompt: 'a'.repeat(501) }, /入れたくない音/],
    ['短すぎる', { durationSec: 0.4 }, /0.5〜10 秒/],
    ['長すぎる', { durationSec: 10.5 }, /0.5〜10 秒/],
    ['本数が多い', { count: 5 }, /1〜4/],
    ['本数が 0', { count: 0 }, /1〜4/],
    ['種が負', { seed: -1 }, /種/],
    ['知らないモデル', { model: { ...stableAudioSfxModel, id: 'sfx_api/other' as never } }, /知らない/],
  ] as const)('%s は送る前に断る', async (_label, overrides, message) => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    await expect(provider(fetchMock).submit(request(overrides))).rejects.toThrow(message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('429 は混んでいる（Retry-After を運ぶ）', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(json(429, { error: { code: 'busy', message: 'full', retryable: true } }, { 'retry-after': '20' })),
    )
    const error: unknown = await provider(fetchMock).submit(request()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderBusyError)
    expect((error as ProviderBusyError).retryAfterMs).toBe(20_000)
  })

  it('封筒の付いた失敗はサーバの code と retryable を運ぶ', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(json(422, { error: { code: 'invalid_params', message: 'bad', retryable: false } })),
    )
    const error: unknown = await provider(fetchMock).submit(request()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ code: 'sfx_api_invalid_params', retryable: false })
  })

  it('使えない workflow（503 workflow_unavailable）は、やり直せない失敗として理由を日本語で言う', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(
        json(503, { error: { code: 'workflow_unavailable', message: 'weights not found in /Users/x/models', retryable: true } }),
      ),
    )
    const error: unknown = await provider(fetchMock).submit(request({ model: mossSfxModel })).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'sfx_api_workflow_unavailable', retryable: false })
    expect((error as Error).message).toMatch(/MOSS SFX v2（手元）は今この Mac で使えません.*もう一方の効果音の AI/)
    expect((error as Error).message).not.toContain('/Users/x')
  })

  it('503 でも封筒が別の code なら、ふつうの失敗として運ぶ', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(json(503, { error: { code: 'loading', message: 'warming up', retryable: true } })),
    )
    await expect(provider(fetchMock).submit(request())).rejects.toMatchObject({ code: 'sfx_api_loading', retryable: true })
  })

  it('形の違う投入応答は失敗にする', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { job: JOB_ID })))
    await expect(provider(fetchMock).submit(request())).rejects.toThrow(/投入応答が仕様と違います/)
  })
})

describe('状態の問い合わせ', () => {
  it('queued / running は待ち。progress を運ぶ', async () => {
    const queued = mockFetch(() => Promise.resolve(json(200, job('queued'))))
    expect(await provider(queued).poll(handle)).toEqual({ state: 'pending', progress: null })
    const running = mockFetch(() => Promise.resolve(json(200, job('running', { progress: 0.25 }))))
    expect(await provider(running).poll(handle)).toEqual({ state: 'running', progress: 0.25 })
  })

  it('succeeded なら本数ぶん WAV を取り込み、手元のパス・実際の長さ・標本化周波数・種で返す', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith(`/v1/jobs/${JOB_ID}`)) {
        return Promise.resolve(
          json(200, job('succeeded', { result: { outputs: [output(1, 1.4), output(0, 1.52)] }, timings: { total_seconds: 1.1 } })),
        )
      }
      const index = new URL(url).searchParams.get('index')
      return Promise.resolve(new Response(new Uint8Array([...WAV, Number(index)]), { status: 200 }))
    })
    const status = await provider(fetchMock).poll(handle)
    if (status.state !== 'succeeded') throw new Error(`成功のはず: ${status.state}`)
    expect(status.outputs.map((o) => [o.durationSec, o.sampleRate, o.channels, o.seedUsed])).toEqual([
      [1.52, 44_100, 2, 42],
      [1.4, 44_100, 2, 44],
    ])
    expect(status.outputs.every((o) => o.path.endsWith('.wav'))).toBe(true)
    const bytes = await Promise.all(status.outputs.map((o) => readFile(o.path)))
    expect(bytes.map((b) => b.at(-1))).toEqual([0, 1])
    expect(status).toMatchObject({ costUsd: 0, raw: { workflow: 'stable-audio-3-sfx', timings: { total_seconds: 1.1 } } })
    const calls = fetchMock.mock.calls
    expect(calls.map(([url]) => url)).toContain(`${BASE_URL}/v1/jobs/${JOB_ID}/output?index=1`)
    const download = calls.find(([url]) => url.includes('/output'))
    expect(new Headers(download?.[1].headers).get('accept')).toBe('audio/wav')
  })

  it('MOSS のモノラル（channels 1・48kHz）も受ける', async () => {
    const fetchMock = mockFetch((url) =>
      Promise.resolve(
        url.endsWith(`/v1/jobs/${JOB_ID}`)
          ? json(200, job('succeeded', { workflow: 'moss-sfx-v2', result: { outputs: [output(0, 2, 48_000, 1)] } }))
          : new Response(WAV, { status: 200 }),
      ),
    )
    const status = await provider(fetchMock).poll(handle)
    expect(status).toMatchObject({ state: 'succeeded', outputs: [{ sampleRate: 48_000, channels: 1 }], raw: { workflow: 'moss-sfx-v2' } })
  })

  it('取り込み済みの音は取りに行かない。release で消える', async () => {
    let downloads = 0
    const fetchMock = mockFetch((url) => {
      if (url.endsWith(`/v1/jobs/${JOB_ID}`)) {
        return Promise.resolve(json(200, job('succeeded', { result: { outputs: [output(0)] } })))
      }
      downloads += 1
      return Promise.resolve(new Response(WAV, { status: 200 }))
    })
    const sfx = provider(fetchMock)
    const first = await sfx.poll(handle)
    await sfx.poll(handle)
    expect(downloads).toBe(1)
    if (first.state !== 'succeeded') throw new Error('成功のはず')
    const path = first.outputs[0]?.path ?? ''
    await sfx.release?.(handle)
    await expect(stat(path)).rejects.toThrow()
  })

  it('取り込みが失敗したら投げる（成功として返さない）', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith(`/v1/jobs/${JOB_ID}`)) {
        return Promise.resolve(json(200, job('succeeded', { result: { outputs: [output(0)] } })))
      }
      return Promise.resolve(json(409, { error: { code: 'conflict', message: 'not ready', retryable: true } }))
    })
    await expect(provider(fetchMock).poll(handle)).rejects.toMatchObject({ code: 'sfx_api_conflict' })
  })

  it('出来上がりの番号が欠けていたら成功にしない', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(json(200, job('succeeded', { result: { outputs: [output(0), output(2)] } }))),
    )
    await expect(provider(fetchMock).poll(handle)).rejects.toThrow(/番号が揃っていません/)
  })

  it('failed はサーバの code と retryable を運び、置き場所を文に出さない', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(
        json(200, job('failed', { error: { code: 'generation_failed', message: 'oom in /Users/someone/x.py', retryable: true } })),
      ),
    )
    const status = await provider(fetchMock).poll(handle)
    expect(status).toMatchObject({ state: 'failed', error: { code: 'sfx_api_generation_failed', retryable: true } })
    expect(JSON.stringify(status)).not.toContain('/Users/someone')
  })

  it('cancelled の綴りも取り消しとして受ける', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(200, job('cancelled'))))
    expect(await provider(fetchMock).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'sfx_api_canceled' } })
  })

  it('形の違う応答（WAV でない・標本化周波数が無い・長さが無い）・別のジョブを指す応答は終端の失敗', async () => {
    const notWav = { ...output(0), media_type: 'audio/mpeg' }
    const noRate = { index: 0, media_type: 'audio/wav', duration_sec: 1.5, channels: 2, seed_used: 42 }
    const noDuration = { index: 0, media_type: 'audio/wav', sample_rate: 44_100, channels: 2, seed_used: 42 }
    const noChannels = { index: 0, media_type: 'audio/wav', duration_sec: 1.5, sample_rate: 44_100, seed_used: 42 }
    const surround = { ...output(0), channels: 6 }
    for (const outputs of [[], [notWav], [noRate], [noDuration], [noChannels], [surround]]) {
      const broken = mockFetch(() => Promise.resolve(json(200, job('succeeded', { result: { outputs } }))))
      expect(await provider(broken).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'sfx_api_invalid_response' } })
    }
    const other = mockFetch(() => Promise.resolve(json(200, { ...job('queued'), id: 'job_OTHER' })))
    expect(await provider(other).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'sfx_api_invalid_response' } })
  })
})

describe('取り消し', () => {
  it('DELETE を送る。もう終わっている（409）・記録が無い（404）は成功として扱う', async () => {
    for (const status of [200, 202, 404, 409]) {
      const fetchMock = mockFetch(() => Promise.resolve(json(status, {})))
      await expect(provider(fetchMock).cancel(handle)).resolves.toBeUndefined()
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/v1/jobs/${JOB_ID}`)
      expect(fetchMock.mock.calls[0]?.[1].method).toBe('DELETE')
    }
  })

  it('それ以外の失敗は投げる', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(500, { error: { code: 'internal', message: 'x', retryable: true } })))
    await expect(provider(fetchMock).cancel(handle)).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('宣言', () => {
  it('手元の GPU を名乗る。2 つのモデル・長さ 0.5〜10 秒・4 本まで・既定の口は 8769', () => {
    const sfx = provider(mockFetch(() => Promise.reject(new Error('呼ばない'))))
    expect(sfx.exclusiveResource).toBe('local-gpu')
    expect(sfx.models).toEqual([stableAudioSfxModel, mossSfxModel])
    expect(stableAudioSfxModel).toMatchObject({ workflowId: 'stable-audio-3-sfx', durationSec: { min: 0.5, max: 10 }, maxCount: 4, sampleRate: 44_100 })
    expect(mossSfxModel).toMatchObject({ workflowId: 'moss-sfx-v2', sampleRate: 48_000 })
    // MOSS は遅い（2 秒の音で 273 秒の実測）。Stable Audio と同じ上限で待つと必ず時間切れになる。
    expect(stableAudioSfxModel.maxWaitSec).toBe(300)
    expect(mossSfxModel.maxWaitSec).toBeGreaterThanOrEqual(60 * 60)
    expect(SFX_API_DEFAULT_BASE_URL).toBe('http://127.0.0.1:8769')
  })

  /** 「使う AI」は workflow ごとに health を見る。domain が書く名前とここの名前がずれると、使えるのに灰色になる。 */
  it('使う AI の見つけ方が指す workflow は、モデルの workflow と同じ', () => {
    expect(AI_TOOLS.stable_audio_sfx.detect).toMatchObject({ workflow: stableAudioSfxModel.workflowId })
    expect(AI_TOOLS.moss_sfx.detect).toMatchObject({ workflow: mossSfxModel.workflowId })
  })
})
