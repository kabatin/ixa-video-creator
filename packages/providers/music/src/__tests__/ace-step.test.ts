import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProviderBusyError, ProviderError, type MusicGenerationRequest, type ProviderJobHandle } from '@ixa/provider-core'
import type { LocalServerFetch } from '@ixa/provider-video'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACE_STEP_MUSIC_MODEL_ID, ACE_STEP_PROVIDER_ID, aceStepMusicModel, minimaxMusic3Model } from '../ace-step/descriptor.js'
import { createAceStepMusicProvider } from '../ace-step/provider.js'

/**
 * ace-step-api の契約（ADR-0048）。**実サーバは叩かない。**
 *
 * 見たいのは: 曲調・歌詞・長さ・歌なし・数を送る（モデルや step は送らない）、冪等キーを付ける、
 * 429 を「混んでいる」にする、出来上がりを曲の数ぶん WAV で取り込む、欠けた成功を成功にしない。
 */

const BASE_URL = 'http://ace-step.test:8768'
const TOKEN = 'a'.repeat(40)
const JOB_ID = 'job_01J9ZK3N2Q8V7W6X5Y4Z3A2B1C'
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])

const mockFetch = (impl: LocalServerFetch) => vi.fn<LocalServerFetch>(impl)
type MockedFetch = ReturnType<typeof mockFetch>

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-ace-step-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const provider = (fetchMock: MockedFetch) =>
  createAceStepMusicProvider({ baseUrl: `${BASE_URL}/`, token: TOKEN, outputDir: join(dir, 'out'), fetch: fetchMock })

const request = (overrides: Partial<MusicGenerationRequest> = {}): MusicGenerationRequest => ({
  model: aceStepMusicModel,
  prompt: 'j-pop, upbeat, female vocal',
  lyrics: '[verse]\nはしれ',
  durationSec: 60,
  instrumental: false,
  seed: 42,
  count: 1,
  idempotencyKey: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  ...overrides,
})

const handle: ProviderJobHandle = {
  providerId: ACE_STEP_PROVIDER_ID,
  modelId: ACE_STEP_MUSIC_MODEL_ID,
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
  workflow: 'ace-step-1.5',
  status,
  created_at: '2026-10-17T12:00:00Z',
  started_at: null,
  finished_at: null,
  ...extra,
})

const output = (index: number, durationSec = 60.2) => ({
  index,
  media_type: 'audio/wav',
  duration_sec: durationSec,
  seed_used: 42 + index,
})

describe('投入', () => {
  it('曲調・歌詞・長さ・歌なし・seed・数を送り、合言葉と冪等キーを付ける', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    const result = await provider(fetchMock).submit(request({ count: 2 }))

    expect(result).toMatchObject({ providerId: ACE_STEP_PROVIDER_ID, modelId: ACE_STEP_MUSIC_MODEL_ID, ref: JOB_ID })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/v1/workflows/ace-step-1.5/jobs`)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('idempotency-key')).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV')
    expect(bodyOf(fetchMock)).toEqual({
      prompt: 'j-pop, upbeat, female vocal',
      lyrics: '[verse]\nはしれ',
      duration_sec: 60,
      instrumental: false,
      seed: 42,
      count: 2,
    })
  })

  it('歌なしなら歌詞は送らない。種が無ければ seed を省く', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    await provider(fetchMock).submit(request({ instrumental: true, seed: null }))
    const body = bodyOf(fetchMock)
    expect(body).toMatchObject({ lyrics: '', instrumental: true })
    expect(body).not.toHaveProperty('seed')
  })

  it.each([
    ['曲調が空', { prompt: '  ' }, /曲調が空/],
    ['曲調が長い', { prompt: 'a'.repeat(1001) }, /曲調が 1000 文字/],
    ['歌詞が長い', { lyrics: 'あ'.repeat(4001) }, /歌詞が 4000 文字/],
    ['短すぎる', { durationSec: 9 }, /10〜240 秒/],
    ['長すぎる', { durationSec: 241 }, /10〜240 秒/],
    ['曲が多い', { count: 5 }, /1〜4/],
    ['曲が 0', { count: 0 }, /1〜4/],
    ['種が負', { seed: -1 }, /種/],
  ] as const)('%s は送る前に断る', async (_label, overrides, message) => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    await expect(provider(fetchMock).submit(request(overrides))).rejects.toThrow(message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('429 は混んでいる（Retry-After を運ぶ）', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(json(429, { error: { code: 'busy', message: 'full', retryable: true } }, { 'retry-after': '30' })),
    )
    const error: unknown = await provider(fetchMock).submit(request()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderBusyError)
    expect((error as ProviderBusyError).retryAfterMs).toBe(30_000)
  })

  it('封筒の付いた失敗はサーバの code と retryable を運ぶ', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(json(422, { error: { code: 'invalid_params', message: 'bad', retryable: false } })),
    )
    const error: unknown = await provider(fetchMock).submit(request()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({ code: 'ace_step_invalid_params', retryable: false })
  })

  it('形の違う投入応答は失敗にする', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { job: JOB_ID })))
    await expect(provider(fetchMock).submit(request())).rejects.toThrow(/投入応答が仕様と違います/)
  })
})

describe('状態の問い合わせ', () => {
  it('queued / running は待ち。progress を運ぶ', async () => {
    const queued = mockFetch(() => Promise.resolve(json(200, job('queued', { waiting_for: 'vpipe-api' }))))
    expect(await provider(queued).poll(handle)).toEqual({ state: 'pending', progress: null })
    const running = mockFetch(() => Promise.resolve(json(200, job('running', { progress: 0.5 }))))
    expect(await provider(running).poll(handle)).toEqual({ state: 'running', progress: 0.5 })
  })

  it('succeeded なら曲の数ぶん WAV を取り込み、手元のパスと実際の長さで返す', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith(`/v1/jobs/${JOB_ID}`)) {
        return Promise.resolve(
          json(
            200,
            job('succeeded', {
              result: { outputs: [output(1, 59.5), output(0, 60.2)], seed_used: 42 },
              timings: { total_seconds: 80.1 },
            }),
          ),
        )
      }
      const index = new URL(url).searchParams.get('index')
      return Promise.resolve(new Response(new Uint8Array([...WAV, Number(index)]), { status: 200 }))
    })
    const status = await provider(fetchMock).poll(handle)
    if (status.state !== 'succeeded') throw new Error(`成功のはず: ${status.state}`)
    expect(status.outputs.map((o) => o.durationSec)).toEqual([60.2, 59.5])
    expect(status.outputs.every((o) => o.path.endsWith('.wav'))).toBe(true)
    const bytes = await Promise.all(status.outputs.map((o) => readFile(o.path)))
    expect(bytes.map((b) => b.at(-1))).toEqual([0, 1])
    expect(status).toMatchObject({ seedUsed: 42, costUsd: 0, raw: { workflow: 'ace-step-1.5', timings: { total_seconds: 80.1 } } })
    const calls = fetchMock.mock.calls
    const urls = calls.map(([url]) => url)
    expect(urls).toContain(`${BASE_URL}/v1/jobs/${JOB_ID}/output?index=0`)
    expect(urls).toContain(`${BASE_URL}/v1/jobs/${JOB_ID}/output?index=1`)
    const download = calls.find(([url]) => url.includes('/output'))
    expect(new Headers(download?.[1].headers).get('accept')).toBe('audio/wav')
  })

  it('取り込み済みの曲は取りに行かない。release で消える', async () => {
    let downloads = 0
    const fetchMock = mockFetch((url) => {
      if (url.endsWith(`/v1/jobs/${JOB_ID}`)) {
        return Promise.resolve(json(200, job('succeeded', { result: { outputs: [output(0)], seed_used: 1 } })))
      }
      downloads += 1
      return Promise.resolve(new Response(WAV, { status: 200 }))
    })
    const aceStep = provider(fetchMock)
    const first = await aceStep.poll(handle)
    await aceStep.poll(handle)
    expect(downloads).toBe(1)
    if (first.state !== 'succeeded') throw new Error('成功のはず')
    const path = first.outputs[0]?.path ?? ''
    await aceStep.release?.(handle)
    await expect(stat(path)).rejects.toThrow()
  })

  it('取り込みが失敗したら投げる（成功として返さない）', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith(`/v1/jobs/${JOB_ID}`)) {
        return Promise.resolve(json(200, job('succeeded', { result: { outputs: [output(0)], seed_used: 1 } })))
      }
      return Promise.resolve(json(409, { error: { code: 'conflict', message: 'not ready', retryable: true } }))
    })
    await expect(provider(fetchMock).poll(handle)).rejects.toMatchObject({ code: 'ace_step_conflict' })
  })

  /** 欠けた成功を成功として返すと、頼んだ数より少ない曲が黙って取り込まれる。 */
  it('出来上がりの番号が欠けていたら成功にしない', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(json(200, job('succeeded', { result: { outputs: [output(0), output(2)], seed_used: 1 } }))),
    )
    await expect(provider(fetchMock).poll(handle)).rejects.toThrow(/番号が揃っていません/)
  })

  it('failed はサーバの code と retryable を運び、置き場所を文に出さない', async () => {
    const fetchMock = mockFetch(() =>
      Promise.resolve(
        json(200, job('failed', { error: { code: 'generation_failed', message: 'crash in /Users/someone/x.py', retryable: true } })),
      ),
    )
    const status = await provider(fetchMock).poll(handle)
    expect(status).toMatchObject({ state: 'failed', error: { code: 'ace_step_generation_failed', retryable: true } })
    expect(JSON.stringify(status)).not.toContain('/Users/someone')
  })

  it('cancelled の綴りも取り消しとして受ける', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(200, job('cancelled'))))
    expect(await provider(fetchMock).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'ace_step_canceled' } })
  })

  it('形の違う応答（WAV でない・長さが無い）・別のジョブを指す応答は終端の失敗', async () => {
    const notWav = { ...output(0), media_type: 'audio/mpeg' }
    const noDuration = { index: 0, media_type: 'audio/wav', seed_used: 42 }
    for (const outputs of [[], [notWav], [noDuration]]) {
      const broken = mockFetch(() => Promise.resolve(json(200, job('succeeded', { result: { outputs, seed_used: 1 } }))))
      expect(await provider(broken).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'ace_step_invalid_response' } })
    }
    const other = mockFetch(() => Promise.resolve(json(200, { ...job('queued'), id: 'job_OTHER' })))
    expect(await provider(other).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'ace_step_invalid_response' } })
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
  it('手元の GPU を名乗る（動画・絵と同じ整理券に並ぶ）。長さ 10〜240 秒・4 曲まで', () => {
    const aceStep = provider(mockFetch(() => Promise.reject(new Error('呼ばない'))))
    expect(aceStep.exclusiveResource).toBe('local-gpu')
    expect(aceStep.models).toEqual([aceStepMusicModel, minimaxMusic3Model])
    expect(aceStepMusicModel).toMatchObject({ durationSec: { min: 10, max: 240 }, maxCount: 4 })
  })
})
