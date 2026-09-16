import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMusicAnalyzer } from '../client.js'
import {
  MusicAnalyzerConnectionError,
  MusicAnalyzerResponseError,
  MusicAnalyzerSchemaError,
} from '../errors.js'

const BASE_URL = 'http://localhost:8100'
const AUDIO_PATH = 'track.wav'

/** `apps/audio` が返す正常な応答（snake_case）。 */
const wireResponse = () => ({
  analyzer_version: 'librosa-v1',
  bpm: 120.0150,
  bpm_confidence: 0.63,
  beats: [0, 0.5, 1, 1.5],
  downbeats: [0],
  sections: [{ start: 0, end: 2, label: 'verse', energy: 0.42 }],
  energy_curve: { hop_sec: 0.023, values: [0, 0.5, 1] },
  onsets: [0, 0.5],
  drops: [1.5],
  duration_sec: 2,
  peaks: [0, 0.5, 1],
})

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** キーを 1 つ落とした新しいオブジェクトを返す（破壊的変更をしない）。 */
const omit = (source: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(source).filter(([name]) => name !== key))

/** `fetch` を差し替える。実サービスへは決して接続しない。 */
const mockFetch = (implementation: (url: string, init?: RequestInit) => Promise<Response>) => {
  const spy = vi.fn(implementation)
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('health', () => {
  it('status が ok なら true', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ status: 'ok' })))
    await expect(createMusicAnalyzer(BASE_URL).health()).resolves.toBe(true)
  })

  it('status が ok 以外なら false', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ status: 'degraded' })))
    await expect(createMusicAnalyzer(BASE_URL).health()).resolves.toBe(false)
  })

  it('HTTP エラーなら false', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({}, 503)))
    await expect(createMusicAnalyzer(BASE_URL).health()).resolves.toBe(false)
  })

  it('接続できなければ false（例外にしない）', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')))
    await expect(createMusicAnalyzer(BASE_URL).health()).resolves.toBe(false)
  })

  it('baseUrl 末尾のスラッシュを重複させない', async () => {
    const spy = mockFetch(() => Promise.resolve(jsonResponse({ status: 'ok' })))
    await createMusicAnalyzer(`${BASE_URL}/`).health()
    expect(spy.mock.calls[0]?.[0]).toBe(`${BASE_URL}/health`)
  })
})

describe('analyze', () => {
  it('camelCase へ変換して返す', async () => {
    mockFetch(() => Promise.resolve(jsonResponse(wireResponse())))
    const result = await createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)

    expect(result.analyzerVersion).toBe('librosa-v1')
    expect(result.bpmConfidence).toBe(0.63)
    expect(result.energyCurve.hopSec).toBe(0.023)
    expect(result.durationSec).toBe(2)
    expect(result.sections).toEqual([{ start: 0, end: 2, label: 'verse', energy: 0.42 }])
    expect(result.peaks).toEqual([0, 0.5, 1])
  })

  it('audio_path を snake_case で POST する', async () => {
    const spy = mockFetch(() => Promise.resolve(jsonResponse(wireResponse())))
    await createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)

    const [url, init] = spy.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/analyze`)
    expect(init?.method).toBe('POST')
    const body = init?.body
    expect(typeof body).toBe('string')
    expect(JSON.parse(typeof body === 'string' ? body : '')).toEqual({ audio_path: AUDIO_PATH })
  })

  it('接続失敗は MusicAnalyzerConnectionError', async () => {
    mockFetch(() => Promise.reject(new TypeError('fetch failed')))
    await expect(createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)).rejects.toBeInstanceOf(
      MusicAnalyzerConnectionError,
    )
  })

  it('接続失敗は元のエラーを cause に保持する', async () => {
    const cause = new TypeError('fetch failed')
    mockFetch(() => Promise.reject(cause))
    await expect(createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)).rejects.toMatchObject({ cause })
  })

  it('解析失敗（500）は MusicAnalyzerResponseError で detail を伝える', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ detail: 'デコードできません' }, 500)))
    await expect(createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)).rejects.toMatchObject({
      name: 'MusicAnalyzerResponseError',
      status: 500,
      detail: 'デコードできません',
    })
  })

  it('404 も MusicAnalyzerResponseError', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ detail: 'ファイルがありません' }, 404)))
    await expect(createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('本文が JSON でないエラー応答でも例外の種類は変わらない', async () => {
    mockFetch(() => Promise.resolve(new Response('boom', { status: 500, statusText: 'Oops' })))
    await expect(createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)).rejects.toBeInstanceOf(
      MusicAnalyzerResponseError,
    )
  })

  it('フィールドが欠けた応答は MusicAnalyzerSchemaError', async () => {
    mockFetch(() => Promise.resolve(jsonResponse(omit(wireResponse(), 'bpm'))))
    await expect(createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)).rejects.toBeInstanceOf(
      MusicAnalyzerSchemaError,
    )
  })

  it('値域を外れた応答は MusicAnalyzerSchemaError', async () => {
    mockFetch(() => Promise.resolve(jsonResponse({ ...wireResponse(), bpm_confidence: 1.5 })))
    await expect(createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)).rejects.toBeInstanceOf(
      MusicAnalyzerSchemaError,
    )
  })

  it('ドメインが知らないセクションラベルは MusicAnalyzerSchemaError', async () => {
    const body = { ...wireResponse(), sections: [{ start: 0, end: 2, label: 'solo', energy: 0.4 }] }
    mockFetch(() => Promise.resolve(jsonResponse(body)))
    await expect(createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)).rejects.toBeInstanceOf(
      MusicAnalyzerSchemaError,
    )
  })

  it('JSON として壊れた応答は MusicAnalyzerSchemaError', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response('{ broken', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    )
    await expect(createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)).rejects.toBeInstanceOf(
      MusicAnalyzerSchemaError,
    )
  })

  it('エラーメッセージに不正なフィールド名が含まれる', async () => {
    mockFetch(() => Promise.resolve(jsonResponse(omit(wireResponse(), 'beats'))))
    await expect(createMusicAnalyzer(BASE_URL).analyze(AUDIO_PATH)).rejects.toThrow(/beats/)
  })
})
