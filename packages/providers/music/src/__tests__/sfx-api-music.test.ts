import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AI_TOOLS, STABLE_AUDIO_MUSIC_DURATION_MAX_SEC } from '@ixa/domain'
import { ProviderBusyError, ProviderError, type MusicGenerationRequest, type ProviderJobHandle } from '@ixa/provider-core'
import type { LocalServerFetch } from '@ixa/provider-video'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STABLE_AUDIO_MUSIC_MODEL_ID,
  STABLE_AUDIO_MUSIC_WORKFLOW_ID,
  stableAudioMusicModel,
} from '../sfx-api/music-descriptor.js'
import { createSfxApiMusicProvider } from '../sfx-api/music-provider.js'
import { SFX_API_PROVIDER_ID } from '../sfx-api/descriptor.js'

/**
 * sfx-api の歌なし BGM（`stable-audio-3-medium-music`。ADR-0048 追記）の契約。**実サーバは叩かない。**
 *
 * 見たいのは: 効果音と同じ本文（説明・長さ・数・種）を曲の workflow に送る、前置きを付けない、
 * 歌あり・歌詞ありを送る前に断る（黙って捨てない）、190 秒を超えたら断る、出来上がりを曲として取り込む。
 */

const BASE_URL = 'http://sfx.test:8769'
const TOKEN = 'c'.repeat(40)
const JOB_ID = 'job_01J9ZK3N2Q8V7W6X5Y4Z3A2B1E'
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])

const mockFetch = (impl: LocalServerFetch) => vi.fn<LocalServerFetch>(impl)
type MockedFetch = ReturnType<typeof mockFetch>

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-sfx-api-music-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const provider = (fetchMock: MockedFetch) =>
  createSfxApiMusicProvider({ baseUrl: `${BASE_URL}/`, token: TOKEN, outputDir: join(dir, 'out'), fetch: fetchMock })

const request = (overrides: Partial<MusicGenerationRequest> = {}): MusicGenerationRequest => ({
  model: stableAudioMusicModel,
  prompt: 'lofi hip hop, mellow piano, 85 bpm',
  lyrics: '',
  durationSec: 30,
  instrumental: true,
  seed: 42,
  count: 1,
  idempotencyKey: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  ...overrides,
})

const handle: ProviderJobHandle = {
  providerId: SFX_API_PROVIDER_ID,
  modelId: STABLE_AUDIO_MUSIC_MODEL_ID,
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
  workflow: STABLE_AUDIO_MUSIC_WORKFLOW_ID,
  status,
  created_at: '2026-10-19T12:00:00Z',
  started_at: null,
  finished_at: null,
  ...extra,
})

/** サーバは i 本目に seed + 2i を使う。 */
const output = (index: number, durationSec = 30) => ({
  index,
  media_type: 'audio/wav',
  duration_sec: durationSec,
  sample_rate: 44_100,
  channels: 2,
  seed_used: 42 + 2 * index,
})

describe('投入', () => {
  /** 「TrackType: Music, VocalType: Instrumental, 」の前置きはサーバが付ける。ixa が付けると二重になる。 */
  it('stable-audio-3-medium-music に説明・長さ・数・種を送り、前置きは付けない。合言葉と冪等キーを付ける', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    const result = await provider(fetchMock).submit(request({ count: 2 }))

    expect(result).toMatchObject({ providerId: SFX_API_PROVIDER_ID, modelId: STABLE_AUDIO_MUSIC_MODEL_ID, ref: JOB_ID })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/v1/workflows/stable-audio-3-medium-music/jobs`)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('idempotency-key')).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAW')
    expect(bodyOf(fetchMock)).toEqual({ prompt: 'lofi hip hop, mellow piano, 85 bpm', duration_sec: 30, count: 2, seed: 42 })
  })

  it('種が無ければ seed を省く', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    await provider(fetchMock).submit(request({ seed: null }))
    expect(bodyOf(fetchMock)).not.toHaveProperty('seed')
  })

  it.each([10, 190])('%s 秒を受ける（範囲の端）', async (durationSec) => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    await provider(fetchMock).submit(request({ durationSec }))
    expect(bodyOf(fetchMock)).toMatchObject({ duration_sec: durationSec })
  })

  it.each([
    ['歌あり', { instrumental: false }, /歌なしの曲だけ/],
    ['歌詞あり', { lyrics: '[verse]\nはしれ' }, /歌詞は使えません/],
    ['説明が空', { prompt: '  ' }, /曲調が空/],
    ['説明が長い', { prompt: 'a'.repeat(1001) }, /1000 文字/],
    ['長すぎる', { durationSec: 190.01 }, /10〜190 秒/],
    ['短すぎる', { durationSec: 9.99 }, /10〜190 秒/],
    ['本数が多い', { count: 5 }, /1〜4/],
    ['種が負', { seed: -1 }, /種/],
    ['知らないモデル', { model: { ...stableAudioMusicModel, id: 'sfx_api/other' as never } }, /知らない/],
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
    await expect(provider(fetchMock).submit(request())).rejects.toMatchObject({ code: 'sfx_api_invalid_params', retryable: false })
  })

  it('使えない workflow（503 workflow_unavailable）は、やり直せない失敗として理由を日本語で言う', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(json(503, { error: { code: 'workflow_unavailable', message: 'weights not found in /Users/x/m', retryable: true } })),
    )
    const error: unknown = await provider(fetchMock).submit(request()).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'sfx_api_workflow_unavailable', retryable: false })
    expect((error as Error).message).toMatch(/Stable Audio 3 Medium（歌なし・手元）は今この Mac で使えません.*曲の AI/)
    expect((error as Error).message).not.toContain('/Users/x')
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
    const running = mockFetch(() => Promise.resolve(json(200, job('running', { progress: 0.5 }))))
    expect(await provider(running).poll(handle)).toEqual({ state: 'running', progress: 0.5 })
  })

  it('succeeded なら曲の数ぶん WAV を取り込み、番号順に手元のパスと実際の長さで返す。種は 1 曲目のもの', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith(`/v1/jobs/${JOB_ID}`)) {
        return Promise.resolve(
          json(200, job('succeeded', { result: { outputs: [output(1), output(0)] }, timings: { total_seconds: 12.5 } })),
        )
      }
      const index = new URL(url).searchParams.get('index')
      return Promise.resolve(new Response(new Uint8Array([...WAV, Number(index)]), { status: 200 }))
    })
    const status = await provider(fetchMock).poll(handle)
    if (status.state !== 'succeeded') throw new Error(`成功のはず: ${status.state}`)
    expect(status.outputs.map((o) => o.durationSec)).toEqual([30, 30])
    expect(status.seedUsed).toBe(42)
    const bytes = await Promise.all(status.outputs.map((o) => readFile(o.path)))
    expect(bytes.map((b) => b.at(-1))).toEqual([0, 1])
    expect(status).toMatchObject({
      costUsd: 0,
      raw: {
        workflow: STABLE_AUDIO_MUSIC_WORKFLOW_ID,
        outputs: [{ index: 0, seed_used: 42, sample_rate: 44_100, channels: 2 }, { index: 1, seed_used: 44 }],
        timings: { total_seconds: 12.5 },
      },
    })
  })

  it('取り込み済みの曲は取りに行かない。release で消える', async () => {
    let downloads = 0
    const fetchMock = mockFetch((url) => {
      if (url.endsWith(`/v1/jobs/${JOB_ID}`)) return Promise.resolve(json(200, job('succeeded', { result: { outputs: [output(0)] } })))
      downloads += 1
      return Promise.resolve(new Response(WAV, { status: 200 }))
    })
    const music = provider(fetchMock)
    const first = await music.poll(handle)
    await music.poll(handle)
    expect(downloads).toBe(1)
    if (first.state !== 'succeeded') throw new Error('成功のはず')
    const path = first.outputs[0]?.path ?? ''
    await music.release?.(handle)
    await expect(stat(path)).rejects.toThrow()
  })

  it('出来上がりの番号が欠けていたら成功にしない', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(200, job('succeeded', { result: { outputs: [output(0), output(2)] } }))))
    await expect(provider(fetchMock).poll(handle)).rejects.toThrow(/番号が揃っていません/)
  })

  it('failed はサーバの code と retryable を運び、置き場所を文に出さない', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(json(200, job('failed', { error: { code: 'generation_failed', message: 'oom in /Users/someone/x.py', retryable: true } }))),
    )
    const status = await provider(fetchMock).poll(handle)
    expect(status).toMatchObject({ state: 'failed', error: { code: 'sfx_api_generation_failed', retryable: true } })
    expect(JSON.stringify(status)).toMatch(/曲を作れませんでした/)
    expect(JSON.stringify(status)).not.toContain('/Users/someone')
  })

  it('cancelled の綴りも取り消しとして受ける', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(200, job('cancelled'))))
    expect(await provider(fetchMock).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'sfx_api_canceled' } })
  })

  it('形の違う応答・別のジョブを指す応答は終端の失敗', async () => {
    const broken = mockFetch(() => Promise.resolve(json(200, job('succeeded', { result: { outputs: [] } }))))
    expect(await provider(broken).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'sfx_api_invalid_response' } })
    const other = mockFetch(() => Promise.resolve(json(200, { ...job('queued'), id: 'job_OTHER' })))
    expect(await provider(other).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'sfx_api_invalid_response' } })
  })
})

describe('取り消し', () => {
  it('DELETE を送る。409・404 は成功として扱い、それ以外の失敗は投げる', async () => {
    for (const status of [200, 404, 409]) {
      const fetchMock = mockFetch(() => Promise.resolve(json(status, {})))
      await expect(provider(fetchMock).cancel(handle)).resolves.toBeUndefined()
      expect(fetchMock.mock.calls[0]?.[1].method).toBe('DELETE')
    }
    const failing = mockFetch(() => Promise.resolve(json(500, { error: { code: 'internal', message: 'x', retryable: true } })))
    await expect(provider(failing).cancel(handle)).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('宣言', () => {
  it('手元の GPU を名乗る。1 モデル・長さ 10〜190 秒・4 曲まで', () => {
    const music = provider(mockFetch(() => Promise.reject(new Error('呼ばない'))))
    expect(music.id).toBe(SFX_API_PROVIDER_ID)
    expect(music.exclusiveResource).toBe('local-gpu')
    expect(music.models).toEqual([stableAudioMusicModel])
    expect(stableAudioMusicModel).toMatchObject({
      id: 'sfx_api/stable-audio-3-medium-music',
      durationSec: { min: 10, max: STABLE_AUDIO_MUSIC_DURATION_MAX_SEC },
      maxCount: 4,
    })
  })

  it('使う AI の見つけ方が指す workflow は、このモデルの workflow と同じ', () => {
    expect(AI_TOOLS.stable_audio_medium_music.detect).toMatchObject({ workflow: STABLE_AUDIO_MUSIC_WORKFLOW_ID })
  })
})
