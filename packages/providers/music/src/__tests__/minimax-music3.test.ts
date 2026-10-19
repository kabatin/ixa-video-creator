import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AI_TOOLS } from '@ixa/domain'
import type { MusicGenerationRequest, ProviderJobHandle } from '@ixa/provider-core'
import type { LocalServerFetch } from '@ixa/provider-video'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACE_STEP_PROVIDER_ID,
  MINIMAX_MUSIC3_MODEL_ID,
  MINIMAX_MUSIC3_WORKFLOW_ID,
  aceStepMusicModel,
  minimaxMusic3Model,
} from '../ace-step/descriptor.js'
import { checkAceStepHealth } from '../ace-step/health.js'
import { createAceStepMusicProvider } from '../ace-step/provider.js'

/**
 * ace-step-api の MiniMax-Music3（`minimax-music3`。ADR-0048 追記）の契約。**実サーバは叩かない。**
 *
 * 本文は ace-step-1.5 とまったく同じ。違うのは workflow と、長さが「上限」であること
 * （62 秒を頼んで 22.9 秒の曲が返ることがある）、とても遅いこと、実際に歌なしで作ったかを `details` で返すこと。
 */

const BASE_URL = 'http://ace-step.test:8768'
const JOB_ID = 'job_01J9ZK3N2Q8V7W6X5Y4Z3A2B1F'
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45])

const mockFetch = (impl: LocalServerFetch) => vi.fn<LocalServerFetch>(impl)
type MockedFetch = ReturnType<typeof mockFetch>

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ixa-minimax-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const provider = (fetchMock: MockedFetch) =>
  createAceStepMusicProvider({ baseUrl: BASE_URL, token: null, outputDir: join(dir, 'out'), fetch: fetchMock })

const request = (overrides: Partial<MusicGenerationRequest> = {}): MusicGenerationRequest => ({
  model: minimaxMusic3Model,
  prompt: 'city pop, female vocal',
  lyrics: '[verse]\nはしれ',
  durationSec: 62,
  instrumental: false,
  seed: 7,
  count: 1,
  ...overrides,
})

const handle: ProviderJobHandle = {
  providerId: ACE_STEP_PROVIDER_ID,
  modelId: MINIMAX_MUSIC3_MODEL_ID,
  ref: JOB_ID,
  submittedAt: new Date(),
}

const bodyOf = (fetchMock: MockedFetch): Record<string, unknown> => {
  const body = fetchMock.mock.calls[0]?.[1].body
  if (typeof body !== 'string') throw new Error('本文が文字列ではありません')
  return JSON.parse(body) as Record<string, unknown>
}

describe('MiniMax-Music3 の投入', () => {
  it('minimax-music3 の workflow に、ace-step-1.5 と同じ本文を送る', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    const result = await provider(fetchMock).submit(request())
    expect(result).toMatchObject({ providerId: ACE_STEP_PROVIDER_ID, modelId: MINIMAX_MUSIC3_MODEL_ID })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/v1/workflows/minimax-music3/jobs`)
    expect(bodyOf(fetchMock)).toEqual({
      prompt: 'city pop, female vocal',
      lyrics: '[verse]\nはしれ',
      duration_sec: 62,
      instrumental: false,
      seed: 7,
      count: 1,
    })
  })

  it('ACE-Step は今までどおり ace-step-1.5 に送る', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    await provider(fetchMock).submit(request({ model: aceStepMusicModel }))
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/v1/workflows/ace-step-1.5/jobs`)
  })

  it('知らないモデルは送る前に断る', async () => {
    const fetchMock = mockFetch(() => Promise.resolve(json(202, { id: JOB_ID })))
    const unknown = { ...minimaxMusic3Model, id: 'ace_step/other' as never }
    await expect(provider(fetchMock).submit(request({ model: unknown }))).rejects.toThrow(/知らない曲のモデル/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('MiniMax-Music3 の出来上がり', () => {
  /** 長さは上限。頼んだ長さではなく、返ってきた実際の長さを使う。 */
  it('実際の長さ（頼んだより短い）と、実際に歌なしで作ったかを記録に残す', async () => {
    const fetchMock = mockFetch((url) =>
      Promise.resolve(
        url.endsWith(`/v1/jobs/${JOB_ID}`)
          ? json(200, {
              id: JOB_ID,
              workflow: MINIMAX_MUSIC3_WORKFLOW_ID,
              status: 'succeeded',
              created_at: '2026-10-19T12:00:00Z',
              started_at: null,
              finished_at: null,
              estimate_seconds: 600,
              result: {
                outputs: [{ index: 0, media_type: 'audio/wav', duration_sec: 22.9, seed_used: 7 }],
                seed_used: 7,
                details: { generation: { instrumental: true } },
              },
            })
          : new Response(WAV, { status: 200 }),
      ),
    )
    const status = await provider(fetchMock).poll(handle)
    if (status.state !== 'succeeded') throw new Error(`成功のはず: ${status.state}`)
    expect(status.outputs.map((o) => o.durationSec)).toEqual([22.9])
    expect(status.raw).toMatchObject({ workflow: 'minimax-music3', details: { generation: { instrumental: true } } })
  })
})

describe('MiniMax-Music3 の宣言', () => {
  it('ace_step のモデルで、長さ 10〜240 秒（上限）・4 曲まで。とても遅いので待つ上限を長く取る', () => {
    expect(minimaxMusic3Model).toMatchObject({
      id: 'ace_step/minimax-music3',
      providerId: ACE_STEP_PROVIDER_ID,
      durationSec: { min: 10, max: 240 },
      maxCount: 4,
    })
    expect(minimaxMusic3Model.label).toContain('MiniMax-Music3')
    // 曲 1 秒あたり約 9 秒。240 秒の曲を 4 つ頼むと 2 時間半かかりうる。
    expect(minimaxMusic3Model.maxWaitSec).toBeGreaterThanOrEqual(240 * 10 * 4)
    // ACE-Step は今までどおり（worker の既定の 15 分）。
    expect(aceStepMusicModel.maxWaitSec).toBeUndefined()
  })

  it('使う AI の見つけ方が指す workflow は、モデルの workflow と同じ', () => {
    expect(AI_TOOLS.minimax_music3.detect).toMatchObject({ workflow: MINIMAX_MUSIC3_WORKFLOW_ID })
    expect(AI_TOOLS.ace_step.detect).toMatchObject({ workflow: 'ace-step-1.5' })
  })
})

describe('checkAceStepHealth', () => {
  const health = (workflows: Record<string, unknown>) => ({
    status: 'ok',
    version: '0.1.0',
    running: 0,
    waiting: 0,
    max_waiting: 2,
    workflows,
  })
  const serve = (body: unknown) => mockFetch(() => Promise.resolve(json(200, body)))

  it('片方のエンジンが使えなくても、もう片方は使える', async () => {
    const body = health({
      'ace-step-1.5': { available: true, loaded: false, reason: null },
      'minimax-music3': { available: false, loaded: false, reason: 'out of memory at /Users/x' },
    })
    const ace = await checkAceStepHealth({ baseUrl: BASE_URL, token: null, workflowId: 'ace-step-1.5', fetch: serve(body) })
    expect(ace).toEqual({ state: 'up', version: '0.1.0' })
    const minimax = await checkAceStepHealth({ baseUrl: BASE_URL, token: null, workflowId: 'minimax-music3', fetch: serve(body) })
    expect(minimax.state === 'down' ? minimax.reason : '').toMatch(/^MiniMax-Music3（手元）は今使えません/)
    expect(JSON.stringify(minimax)).not.toContain('/Users/x')
  })

  it('サーバが止まっていれば ace-step-api の起こし方を言う', async () => {
    const refused = mockFetch(() => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })))
    const result = await checkAceStepHealth({ baseUrl: BASE_URL, token: null, workflowId: 'minimax-music3', fetch: refused })
    expect(result).toEqual({ state: 'down', reason: '起動していません（ace-step-api を起動してください）' })
  })
})
