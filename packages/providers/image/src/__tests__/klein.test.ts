import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MediaAssetId } from '@ixa/domain'
import { ProviderBusyError, ProviderError, type ImageGenerationRequest, type ProviderJobHandle } from '@ixa/provider-core'
import type { LocalServerFetch } from '@ixa/provider-video'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KLEIN_IMAGE_MODEL_ID, KLEIN_PROVIDER_ID, kleinImageModel } from '../klein/descriptor.js'
import { createKleinImageProvider } from '../klein/provider.js'

/**
 * klein-api の契約（ADR-0047。正は klein-api の `docs/api.md`）。**実サーバは叩かない。**
 *
 * 見たいのは: 段だけを送る（モデル・step を送らない）、大きさと枚数を必ず明示する、
 * 429 を「混んでいる」にする、出来上がりを枚数ぶん取り込む、欠けた成功を成功にしない。
 */

const BASE_URL = 'http://klein.test:8767'
const TOKEN = 'k'.repeat(40)
const JOB_ID = 'job_01J9ZK3N2Q8V7W6X5Y4Z3A2B1C'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7])

const mockFetch = (impl: LocalServerFetch) => vi.fn<LocalServerFetch>(impl)
type MockedFetch = ReturnType<typeof mockFetch>

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-klein-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const provider = (fetchMock: MockedFetch) =>
  createKleinImageProvider({ baseUrl: `${BASE_URL}/`, token: TOKEN, outputDir: join(dir, 'out'), fetch: fetchMock })

const request = (overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest => ({
  model: kleinImageModel,
  prompt: '雨上がりの路面電車',
  negativePrompt: null,
  resolution: { width: 1344, height: 768 },
  aspectRatio: '16:9',
  seed: 42,
  references: [],
  resolveReference: () => Promise.reject(new Error('参照は無いはず')),
  count: 1,
  idempotencyKey: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  ...overrides,
})

/** 参照を受けると宣言したモデル（通信の形を確かめるため。今の宣言は 0 枚）。 */
const withReferences = {
  ...kleinImageModel,
  capabilities: { ...kleinImageModel.capabilities, referenceImages: { max: 4, roles: ['subject' as const] } },
}

const handle: ProviderJobHandle = {
  providerId: KLEIN_PROVIDER_ID,
  modelId: KLEIN_IMAGE_MODEL_ID,
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
  workflow: 'flux2-klein',
  status,
  created_at: '2026-10-16T12:00:00Z',
  started_at: null,
  finished_at: null,
  ...extra,
})

const output = (index: number) => ({ index, media_type: 'image/png', width: 1344, height: 768, seed_used: 42 + index })

describe('投入', () => {
  it('段は standard だけを送り、大きさ・枚数・seed を明示する。モデルや step は送らない', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    const result = await provider(fetchMock).submit(request({ count: 2 }))

    expect(result).toMatchObject({ providerId: KLEIN_PROVIDER_ID, modelId: KLEIN_IMAGE_MODEL_ID, ref: JOB_ID })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/v1/workflows/flux2-klein/jobs`)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('idempotency-key')).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV')
    expect(bodyOf(fetchMock)).toEqual({
      prompt: '雨上がりの路面電車',
      output: { width: 1344, height: 768 },
      quality: 'standard',
      seed: 42,
      count: 2,
      reference_images: [],
    })
  })

  it('参照は手元のファイルを読んで base64 で送る（順番を保つ）', async () => {
    const first = join(dir, 'a.png')
    const second = join(dir, 'b.JPG')
    await writeFile(first, PNG)
    await writeFile(second, Buffer.from('jpeg-bytes'))
    const ids = [MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1'), MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA2')]
    const paths = new Map([[ids[0], first], [ids[1], second]])
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))

    await provider(fetchMock).submit(
      request({
        model: withReferences,
        references: ids.map((mediaAssetId) => ({ mediaAssetId, role: 'subject' as const })),
        resolveReference: (id) => Promise.resolve(paths.get(id) ?? ''),
      }),
    )
    expect(bodyOf(fetchMock).reference_images).toEqual([
      { data: Buffer.from(PNG).toString('base64'), media_type: 'image/png' },
      { data: Buffer.from('jpeg-bytes').toString('base64'), media_type: 'image/jpeg' },
    ])
  })

  it('PNG・JPEG・WebP でない参照は送る前に断る（置き場所は文に入れない）', async () => {
    const path = join(dir, 'secret-place.gif')
    await writeFile(path, 'gif')
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    const id = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1')
    const run = provider(fetchMock).submit(
      request({ model: withReferences, references: [{ mediaAssetId: id, role: 'subject' }], resolveReference: () => Promise.resolve(path) }),
    )
    await expect(run).rejects.toThrow(/1 枚目は PNG・JPEG・WebP ではありません/)
    await expect(run).rejects.not.toThrow(/secret-place/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /** 実測は 2 枚まで（3 枚目以降は未実測で、klein-api も既定で 422）。宣言を超えたら送る前に断る。 */
  it('宣言（2 枚）を超える参照は送る前に断る', async () => {
    expect(kleinImageModel.capabilities.referenceImages.max).toBe(2)
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    const ids = ['01ARZ3NDEKTSV4RRFFQ69G5FA1', '01ARZ3NDEKTSV4RRFFQ69G5FA2', '01ARZ3NDEKTSV4RRFFQ69G5FA3'].map((id) => MediaAssetId.parse(id))
    await expect(
      provider(fetchMock).submit(
        request({ references: ids.map((mediaAssetId) => ({ mediaAssetId, role: 'subject' as const })), resolveReference: () => Promise.resolve('/x.png') }),
      ),
    ).rejects.toThrow(/参照画像/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('モデルが作れない大きさ・negative prompt は送る前に断る', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    await expect(provider(fetchMock).submit(request({ resolution: { width: 1920, height: 1080 } }))).rejects.toThrow(/解像度/)
    await expect(provider(fetchMock).submit(request({ negativePrompt: 'blurry' }))).rejects.toThrow(/negative prompt/)
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
    expect(error).toMatchObject({ code: 'klein_invalid_params', retryable: false })
  })
})

describe('状態の問い合わせ', () => {
  it('queued / running は待ち。progress を運ぶ', async () => {
    const queued = mockFetch(() => Promise.resolve(json(200, job('queued', { waiting_for: 'vpipe-api' }))))
    expect(await provider(queued).poll(handle)).toEqual({ state: 'pending', progress: null })
    const running = mockFetch(() => Promise.resolve(json(200, job('running', { progress: 0.5 }))))
    expect(await provider(running).poll(handle)).toEqual({ state: 'running', progress: 0.5 })
  })

  it('succeeded なら枚数ぶん PNG を取り込み、手元のパスで返す', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith(`/v1/jobs/${JOB_ID}`)) {
        return Promise.resolve(
          json(200, job('succeeded', { result: { outputs: [output(1), output(0)], seed_used: 42 }, timings: { total_seconds: 51.4 } })),
        )
      }
      const index = new URL(url).searchParams.get('index')
      return Promise.resolve(new Response(new Uint8Array([...PNG, Number(index)]), { status: 200 }))
    })
    const status = await provider(fetchMock).poll(handle)
    if (status.state !== 'succeeded') throw new Error(`成功のはず: ${status.state}`)
    expect(status.outputs).toHaveLength(2)
    const bytes = await Promise.all(
      status.outputs.map((o) => (o.type === 'local' ? readFile(o.path) : Promise.reject(new Error('local のはず')))),
    )
    expect(bytes.map((b) => b.at(-1))).toEqual([0, 1])
    expect(status).toMatchObject({ seedUsed: 42, costUsd: 0, raw: { workflow: 'flux2-klein', timings: { total_seconds: 51.4 } } })
    const urls = fetchMock.mock.calls.map(([url]) => url)
    expect(urls).toContain(`${BASE_URL}/v1/jobs/${JOB_ID}/output?index=0`)
    expect(urls).toContain(`${BASE_URL}/v1/jobs/${JOB_ID}/output?index=1`)
  })

  it('取り込み済みの絵は取りに行かない。release で消える', async () => {
    let downloads = 0
    const fetchMock = mockFetch((url) => {
      if (url.endsWith(`/v1/jobs/${JOB_ID}`)) {
        return Promise.resolve(json(200, job('succeeded', { result: { outputs: [output(0)], seed_used: 1 } })))
      }
      downloads += 1
      return Promise.resolve(new Response(PNG, { status: 200 }))
    })
    const klein = provider(fetchMock)
    const first = await klein.poll(handle)
    await klein.poll(handle)
    expect(downloads).toBe(1)
    if (first.state !== 'succeeded' || first.outputs[0]?.type !== 'local') throw new Error('成功のはず')
    const path = first.outputs[0].path
    await klein.release?.(handle)
    await expect(stat(path)).rejects.toThrow()
  })

  /** 欠けた成功を成功として返すと、頼んだ枚数より少ない絵が黙って取り込まれる。 */
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
    expect(status).toMatchObject({ state: 'failed', error: { code: 'klein_generation_failed', retryable: true } })
    expect(JSON.stringify(status)).not.toContain('/Users/someone')
  })

  it('cancelled の綴りも取り消しとして受ける', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(200, job('cancelled'))))
    expect(await provider(fetchMock).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'klein_canceled' } })
  })

  it('形の違う応答・別のジョブを指す応答は終端の失敗（pending へ丸めない）', async () => {
    const broken = mockFetch(() => Promise.resolve(json(200, job('succeeded', { result: { outputs: [] } }))))
    expect(await provider(broken).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'klein_invalid_response' } })
    const other = mockFetch(() => Promise.resolve(json(200, { ...job('queued'), id: 'job_OTHER' })))
    expect(await provider(other).poll(handle)).toMatchObject({ state: 'failed', error: { code: 'klein_invalid_response' } })
  })
})

describe('取り消し', () => {
  it('もう終わっている（409）・記録が無い（404）は成功として扱う', async () => {
    for (const status of [200, 202, 404, 409]) {
      const fetchMock = mockFetch(() => Promise.resolve(json(status, {})))
      await expect(provider(fetchMock).cancel(handle)).resolves.toBeUndefined()
      expect(fetchMock.mock.calls[0]?.[1].method).toBe('DELETE')
    }
  })
})

describe('宣言', () => {
  it('手元の GPU を名乗る（動画と同じ整理券に並ぶ）', () => {
    expect(provider(mockFetch(() => Promise.reject(new Error('呼ばない')))).exclusiveResource).toBe('local-gpu')
  })
})
