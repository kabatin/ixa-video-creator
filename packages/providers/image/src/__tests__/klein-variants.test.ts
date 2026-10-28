import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MediaAssetId, ModelId } from '@ixa/domain'
import type { ImageGenerationRequest, ImageModelDescriptor, ProviderJobHandle } from '@ixa/provider-core'
import type { LocalServerFetch } from '@ixa/provider-video'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KLEIN_4B_IMAGE_MODEL_ID,
  KLEIN_IMAGE_MODELS,
  KLEIN_PROVIDER_ID,
  Z_IMAGE_TURBO_MODEL_ID,
  klein4bImageModel,
  kleinImageModel,
  zImageTurboModel,
} from '../klein/descriptor.js'
import { checkKleinHealth } from '../klein/health.js'
import { createKleinImageProvider } from '../klein/provider.js'

/**
 * klein-api の 3 つのモデル（ADR-0065）。**実サーバは叩かない。**
 * 9B = flux2-klein の standard、4B = flux2-klein の draft、Z Image Turbo = z-image-turbo の standard。
 */

const BASE_URL = 'http://klein.test:8767'
const JOB_ID = 'job_01J9ZK3N2Q8V7W6X5Y4Z3A2B1C'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7])

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-klein-v-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const provider = (fetchMock: LocalServerFetch) =>
  createKleinImageProvider({ baseUrl: BASE_URL, token: null, outputDir: join(dir, 'out'), fetch: fetchMock })

const request = (model: ImageModelDescriptor, overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest => ({
  model,
  prompt: '夜の商店街',
  negativePrompt: null,
  resolution: { width: 1344, height: 768 },
  aspectRatio: '16:9',
  seed: 7,
  references: [],
  resolveReference: () => Promise.reject(new Error('参照は無いはず')),
  count: 1,
  idempotencyKey: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  ...overrides,
})

const submitted = async (model: ImageModelDescriptor) => {
  const fetchMock = vi.fn<LocalServerFetch>(() => Promise.resolve(json(202, { id: JOB_ID })))
  const handle = await provider(fetchMock).submit(request(model))
  const [url, init] = fetchMock.mock.calls[0] ?? []
  if (typeof init?.body !== 'string') throw new Error('本文が文字列ではありません')
  return { handle, url, body: JSON.parse(init.body) as Record<string, unknown> }
}

describe('投入（モデルごとの workflow と段）', () => {
  it('9B は flux2-klein の standard', async () => {
    const { url, body, handle } = await submitted(kleinImageModel)
    expect(url).toBe(`${BASE_URL}/v1/workflows/flux2-klein/jobs`)
    expect(body.quality).toBe('standard')
    expect(handle.modelId).toBe(kleinImageModel.id)
  })

  it('4B は同じ flux2-klein の draft。ジョブには 4B のモデルを記す', async () => {
    const { url, body, handle } = await submitted(klein4bImageModel)
    expect(url).toBe(`${BASE_URL}/v1/workflows/flux2-klein/jobs`)
    expect(body.quality).toBe('draft')
    expect(handle).toMatchObject({ providerId: KLEIN_PROVIDER_ID, modelId: KLEIN_4B_IMAGE_MODEL_ID })
  })

  it('Z Image Turbo は z-image-turbo の standard。本文は flux2-klein と同じ形（モデル名や step は送らない）', async () => {
    const { url, body, handle } = await submitted(zImageTurboModel)
    expect(url).toBe(`${BASE_URL}/v1/workflows/z-image-turbo/jobs`)
    expect(body).toEqual({
      prompt: '夜の商店街',
      output: { width: 1344, height: 768 },
      quality: 'standard',
      seed: 7,
      count: 1,
      reference_images: [],
    })
    expect(handle.modelId).toBe(Z_IMAGE_TURBO_MODEL_ID)
  })

  it('Z Image Turbo は参照の画像を受けない（送る前に断る）', async () => {
    const fetchMock = vi.fn<LocalServerFetch>(() => Promise.resolve(json(202, { id: JOB_ID })))
    const mediaAssetId = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1')
    await expect(
      provider(fetchMock).submit(
        request(zImageTurboModel, { references: [{ mediaAssetId, role: 'subject' }], resolveReference: () => Promise.resolve('/x.png') }),
      ),
    ).rejects.toThrow(/参照画像/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Z Image Turbo の大きさはどれも 64 の倍数', () => {
    for (const { width, height } of zImageTurboModel.capabilities.resolutions) {
      expect(width % 64).toBe(0)
      expect(height % 64).toBe(0)
    }
  })

  it('klein-api のモデルでないものは送る前に断る', async () => {
    const fetchMock = vi.fn<LocalServerFetch>(() => Promise.resolve(json(202, { id: JOB_ID })))
    const other = { ...kleinImageModel, id: ModelId.parse('klein/unknown') }
    await expect(provider(fetchMock).submit(request(other))).rejects.toThrow(/klein-api のモデルではありません/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('口は 3 つのモデルを名乗る', () => {
    expect(provider(vi.fn<LocalServerFetch>()).models.map((m) => m.id)).toEqual(KLEIN_IMAGE_MODELS.map((m) => m.id))
  })
})

describe('状態の問い合わせ', () => {
  it('Z Image の出来上がりは workflow の名前を raw に残す', async () => {
    const handle: ProviderJobHandle = { providerId: KLEIN_PROVIDER_ID, modelId: Z_IMAGE_TURBO_MODEL_ID, ref: JOB_ID, submittedAt: new Date() }
    const fetchMock = vi.fn<LocalServerFetch>((url) =>
      Promise.resolve(
        url.endsWith(`/v1/jobs/${JOB_ID}`)
          ? json(200, {
              id: JOB_ID,
              workflow: 'z-image-turbo',
              status: 'succeeded',
              created_at: '2026-10-28T12:00:00Z',
              started_at: null,
              finished_at: null,
              result: { outputs: [{ index: 0, media_type: 'image/png', width: 1344, height: 768, seed_used: 7 }], seed_used: 7 },
            })
          : new Response(PNG, { status: 200 }),
      ),
    )
    const status = await provider(fetchMock).poll(handle)
    expect(status).toMatchObject({ state: 'succeeded', seedUsed: 7, raw: { workflow: 'z-image-turbo' } })
  })
})

const health = (workflows: Record<string, unknown> | undefined) => ({
  status: 'ok',
  version: '0.2.0',
  running: 0,
  waiting: 0,
  max_waiting: 2,
  ...(workflows === undefined ? {} : { workflows }),
})
const serve = (body: unknown) => vi.fn<LocalServerFetch>(() => Promise.resolve(json(200, body)))

describe('checkKleinHealth', () => {
  const workflows = {
    'flux2-klein': { available: true, loaded: false, reason: null },
    'z-image-turbo': { available: false, loaded: false, reason: 'weights not found at /Users/x/z-image' },
  }

  it('workflow ごとに見る。使えない方は名前と理由で言い、置き場所は出さない', async () => {
    const up = await checkKleinHealth({ baseUrl: BASE_URL, token: null, workflowId: 'flux2-klein', fetch: serve(health(workflows)) })
    expect(up).toEqual({ state: 'up', version: '0.2.0' })
    const down = await checkKleinHealth({ baseUrl: BASE_URL, token: null, workflowId: 'z-image-turbo', fetch: serve(health(workflows)) })
    expect(down.state === 'down' ? down.reason : '').toMatch(/^Z Image Turbo（手元）は今使えません/)
    expect(JSON.stringify(down)).not.toContain('/Users/x')
  })

  it('一覧を返さない古い版: flux2-klein は使える、z-image-turbo は「無い」（更新を促す）', async () => {
    const flux = await checkKleinHealth({ baseUrl: BASE_URL, token: null, workflowId: 'flux2-klein', fetch: serve(health(undefined)) })
    expect(flux.state).toBe('up')
    const z = await checkKleinHealth({ baseUrl: BASE_URL, token: null, workflowId: 'z-image-turbo', fetch: serve(health(undefined)) })
    expect(z.state === 'down' ? z.reason : '').toMatch(/Z Image Turbo（手元）はこの klein-api にありません.*新しい版/)
  })

  it('一覧に無い workflow は使えない', async () => {
    const result = await checkKleinHealth({
      baseUrl: BASE_URL,
      token: null,
      workflowId: 'z-image-turbo',
      fetch: serve(health({ 'flux2-klein': { available: true } })),
    })
    expect(result.state).toBe('down')
  })
})
