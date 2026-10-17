import { OpenAPIHono } from '@hono/zod-openapi'
import type { AiToolId, SfxJobId, SfxSuggestionInput } from '@ixa/domain'
import { createInMemorySfxJobRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { MOSS_TOO_MANY_MESSAGE, SFX_CUES_PER_REQUEST_MAX, sfxGenerateRoutes } from '../routes/sfx-generate.js'
import type { SfxGenerationDeps } from '../sfx/deps.js'
import { chooseSfxModel, NO_SFX_AI_MESSAGE, type SfxModelChoice } from '../sfx/sfx-model.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 効果音を作る（ADR-0052）。きっかけごとにジョブを作って worker の `sfx` キューへ入れる（作るのは worker）。
 * 範囲は sfx-api の契約と同じ。効果音の AI がお試し・この環境で使えないときは頼まない（409）。
 */

type Ok<T> = { success: true; data: T }
type Err = { success: false; error: string; fields?: Record<string, string[]> }

const READY: SfxModelChoice = { state: 'ready', tool: 'stable_audio_sfx', model: 'sfx_api/stable-audio-3-sfx' }
const MOSS: SfxModelChoice = { state: 'ready', tool: 'moss_sfx', model: 'sfx_api/moss-sfx-v2' }

const TIMELINE: SfxSuggestionInput = {
  video1: [
    { shotId: 's1', startSec: 0 },
    { shotId: 's2', startSec: 4 },
  ],
  transitions: [{ fromShotId: 's1', toShotId: 's2', type: 'whip_pan', durationSec: 0.4 }],
  clips: [{ track: 'VFX', startSec: 1, durationSec: 0.4, content: { type: 'motion_graphics', templateKey: 'flash', params: {} } }],
}

const setup = (options: { readonly choice?: SfxModelChoice; readonly enqueueFails?: boolean } = {}) => {
  const project = aProject()
  const enqueued: SfxJobId[] = []
  const asked: (AiToolId | undefined)[] = []
  const events = createInMemoryProjectEvents()
  const sfxJobs = createInMemorySfxJobRepository()
  const logger = createLogger('silent')
  const deps = {
    projects: createInMemoryProjectRepository([project]),
    sfxJobs,
    sfxModel: (tool?: AiToolId) => {
      asked.push(tool)
      return Promise.resolve(options.choice ?? (tool === 'moss_sfx' ? MOSS : READY))
    },
    sfxQueue: {
      enqueue: (id: SfxJobId) => {
        if (options.enqueueFails === true) return Promise.reject(new Error('Redis に繋がりません'))
        enqueued.push(id)
        return Promise.resolve()
      },
    },
    events,
    logger,
  } satisfies SfxGenerationDeps
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route(
    '/',
    sfxGenerateRoutes({ ...deps, suggestionSource: (id) => Promise.resolve(id === project.id ? TIMELINE : null) }),
  )
  registerErrorHandlers(app, logger)
  const send = (method: string, path: string, payload?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
  return { project, enqueued, asked, events, sfxJobs, send }
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T
const cue = (overrides: Record<string, unknown> = {}) => ({ startSec: 3.75, durationSec: 1, prompt: 'cinematic impact hit', ...overrides })

describe('POST /projects/{projectId}/sfx/generate', () => {
  it('きっかけごとにジョブを作ってキューへ入れ、出来事を流す（音量・本数は既定）', async () => {
    const { project, enqueued, asked, events, sfxJobs, send } = setup()

    const response = await send('POST', `/projects/${project.id}/sfx/generate`, {
      cues: [cue(), cue({ startSec: 8, prompt: 'fast whoosh', volume: 0.5 })],
    })

    expect(response.status).toBe(202)
    const { data } = await json<Ok<{ jobIds: string[] }>>(response)
    expect(data.jobIds).toHaveLength(2)
    expect(enqueued).toEqual(data.jobIds)
    expect(asked).toEqual([undefined])
    expect(sfxJobs.snapshot().map((job) => [job.tool, job.model, job.status, job.spec])).toEqual([
      ['stable_audio_sfx', 'sfx_api/stable-audio-3-sfx', 'queued', { cue: { ...cue(), volume: 0.8 }, count: 1, seed: null }],
      [
        'stable_audio_sfx',
        'sfx_api/stable-audio-3-sfx',
        'queued',
        { cue: { startSec: 8, durationSec: 1, prompt: 'fast whoosh', volume: 0.5 }, count: 1, seed: null },
      ],
    ])
    expect(events.published()).toMatchObject([
      { type: 'sfx_job.status', jobId: data.jobIds[0], status: 'queued' },
      { type: 'sfx_job.status', jobId: data.jobIds[1], status: 'queued' },
    ])
  })

  it('AI を指定すればそれで作る。本数と種・入れたくない音をそのまま記す', async () => {
    const { project, asked, sfxJobs, send } = setup()
    const response = await send('POST', `/projects/${project.id}/sfx/generate`, {
      cues: [cue({ negativePrompt: 'music, voice' })],
      tool: 'moss_sfx',
      count: 4,
      seed: 9,
    })
    expect(response.status).toBe(202)
    expect(asked).toEqual(['moss_sfx'])
    expect(sfxJobs.snapshot()[0]).toMatchObject({ tool: 'moss_sfx', spec: { count: 4, seed: 9, cue: { negativePrompt: 'music, voice' } } })
  })

  /** 同じ説明・長さの 2 つのきっかけに同じ種を渡すと、Stable Audio はビット一致の同じ音を返す。 */
  it('種を 1 つ指定したら、きっかけごとに本数ぶん空けた別の種にする', async () => {
    const { project, sfxJobs, send } = setup()
    await send('POST', `/projects/${project.id}/sfx/generate`, { cues: [cue(), cue({ startSec: 8 }), cue({ startSec: 9 })], count: 2, seed: 100 })
    expect(sfxJobs.snapshot().map((job) => job.spec.seed)).toEqual([100, 104, 108])
  })

  it('MOSS は きっかけ × 本数 が 4 本を超えたら頼まず、理由を言う', async () => {
    const { project, enqueued, send } = setup()
    const response = await send('POST', `/projects/${project.id}/sfx/generate`, { cues: [cue(), cue(), cue()], count: 2, tool: 'moss_sfx' })
    expect(response.status).toBe(422)
    expect((await json<Err>(response)).error).toBe(MOSS_TOO_MANY_MESSAGE)
    expect(enqueued).toEqual([])
    const fine = await send('POST', `/projects/${project.id}/sfx/generate`, { cues: [cue(), cue()], count: 2, tool: 'moss_sfx' })
    expect(fine.status).toBe(202)
    // Stable Audio は速いので多く頼める。
    expect((await send('POST', `/projects/${project.id}/sfx/generate`, { cues: [cue(), cue(), cue()], count: 2 })).status).toBe(202)
  })

  it.each([
    ['きっかけが無い', { cues: [] }, 'cues'],
    ['きっかけが多すぎる', { cues: Array.from({ length: SFX_CUES_PER_REQUEST_MAX + 1 }, () => cue()) }, 'cues'],
    ['説明が日本語', { cues: [cue({ prompt: '爆発音' })] }, 'cues.0.prompt'],
    ['説明が 500 字を超える', { cues: [cue({ prompt: 'a'.repeat(501) })] }, 'cues.0.prompt'],
    ['長さが 0.4 秒', { cues: [cue({ durationSec: 0.4 })] }, 'cues.0.durationSec'],
    ['長さが 10.5 秒', { cues: [cue({ durationSec: 10.5 })] }, 'cues.0.durationSec'],
    ['音量が 2 を超える', { cues: [cue({ volume: 2.5 })] }, 'cues.0.volume'],
    ['時刻が負', { cues: [cue({ startSec: -1 })] }, 'cues.0.startSec'],
    ['時刻が 1 時間を超える', { cues: [cue({ startSec: 3601 })] }, 'cues.0.startSec'],
    ['入れたくない音が日本語', { cues: [cue({ negativePrompt: '音楽' })] }, 'cues.0.negativePrompt'],
    ['本数が 5', { cues: [cue()], count: 5 }, 'count'],
    ['種が負', { cues: [cue()], seed: -1 }, 'seed'],
    ['曲の AI を指定', { cues: [cue()], tool: 'ace_step' }, 'tool'],
  ] as const)('%s は 422（頼まない）', async (_label, payload, field) => {
    const { project, enqueued, send } = setup()
    const response = await send('POST', `/projects/${project.id}/sfx/generate`, payload)
    expect(response.status).toBe(422)
    expect((await json<Err>(response)).fields?.[field]).toBeDefined()
    expect(enqueued).toEqual([])
  })

  it('説明が日本語なら、英語で書くよう理由を言う', async () => {
    const { project, send } = setup()
    const response = await send('POST', `/projects/${project.id}/sfx/generate`, { cues: [cue({ prompt: '爆発音' })] })
    expect((await json<Err>(response)).fields?.['cues.0.prompt']?.[0]).toMatch(/英語で書いて/)
  })

  it('効果音の AI がお試し・この環境で使えないときは 409 で理由を言う（頼まない）', async () => {
    const { project, enqueued, sfxJobs, send } = setup({ choice: { state: 'unavailable', reason: NO_SFX_AI_MESSAGE } })
    const response = await send('POST', `/projects/${project.id}/sfx/generate`, { cues: [cue()] })
    expect(response.status).toBe(409)
    expect((await json<Err>(response)).error).toBe(NO_SFX_AI_MESSAGE)
    expect(enqueued).toEqual([])
    expect(sfxJobs.snapshot()).toEqual([])
  })

  it('無い作品は 404', async () => {
    const { send } = setup()
    expect((await send('POST', '/projects/01ARZ3NDEKTSV4RRFFQ69G5FAV/sfx/generate', { cues: [cue()] })).status).toBe(404)
  })

  it('キューへ入れ損ねたら失敗にしてから 500（待っているまま残さない）', async () => {
    const { project, sfxJobs, events, send } = setup({ enqueueFails: true })
    const response = await send('POST', `/projects/${project.id}/sfx/generate`, { cues: [cue()] })
    expect(response.status).toBe(500)
    expect(sfxJobs.snapshot()[0]).toMatchObject({ status: 'failed', error: { code: 'enqueue_failed' } })
    expect(events.published()).toMatchObject([{ type: 'sfx_job.status', status: 'failed' }])
  })
})

describe('ジョブの状態・記録・取り消し', () => {
  it('GET /sfx-jobs/{id} は状態を返し、無ければ 404', async () => {
    const { project, send } = setup()
    const created = await json<Ok<{ jobIds: string[] }>>(
      await send('POST', `/projects/${project.id}/sfx/generate`, { cues: [cue()], count: 2 }),
    )
    const response = await send('GET', `/sfx-jobs/${created.data.jobIds[0] ?? ''}`)
    expect(response.status).toBe(200)
    expect((await json<Ok<unknown>>(response)).data).toMatchObject({
      id: created.data.jobIds[0],
      status: 'queued',
      tool: 'stable_audio_sfx',
      cue: { startSec: 3.75, durationSec: 1, prompt: 'cinematic impact hit', volume: 0.8 },
      count: 2,
      mediaAssetIds: [],
      seedsUsed: [],
      timelineClipId: null,
      error: null,
    })
    expect((await send('GET', '/sfx-jobs/01ARZ3NDEKTSV4RRFFQ69G5FAV')).status).toBe(404)
  })

  it('作品の記録は新しい順。止めると待っているものが止まり、出来事を流す', async () => {
    const { project, events, send } = setup()
    await send('POST', `/projects/${project.id}/sfx/generate`, { cues: [cue({ prompt: 'first' }), cue({ prompt: 'second' })] })

    const recent = await json<Ok<{ cue: { prompt: string } }[]>>(await send('GET', `/projects/${project.id}/sfx-jobs`))
    expect(recent.data.map((job) => job.cue.prompt)).toEqual(['second', 'first'])

    const cancelled = await send('POST', `/projects/${project.id}/sfx-jobs/cancel`)
    expect((await json<Ok<{ cancelledJobIds: string[] }>>(cancelled)).data.cancelledJobIds).toHaveLength(2)
    expect(events.published().filter((event) => event.type === 'sfx_job.status' && event.status === 'cancelled')).toHaveLength(2)
  })
})

describe('できた音の種', () => {
  it('成功したジョブは、素材と同じ順で 1 本ずつの種を返す', async () => {
    const { project, sfxJobs, send } = setup()
    const created = await json<Ok<{ jobIds: string[] }>>(await send('POST', `/projects/${project.id}/sfx/generate`, { cues: [cue()], count: 2 }))
    const id = created.data.jobIds[0] as SfxJobId
    await sfxJobs.markRunning(id)
    await sfxJobs.markSucceeded(id, {
      mediaAssetIds: ['01ARZ3NDEKTSV4RRFFQ69G5FA1', '01ARZ3NDEKTSV4RRFFQ69G5FA2'] as never[],
      timelineClipId: null,
      providerRecord: { seedsUsed: [11, 13] },
    })
    const job = await json<Ok<{ seedsUsed: (number | null)[] }>>(await send('GET', `/sfx-jobs/${id}`))
    expect(job.data.seedsUsed).toEqual([11, 13])
  })
})

describe('GET /projects/{projectId}/sfx/suggestions', () => {
  it('タイムラインのエフェクトとトランジションから案を時刻順に返す（作らない）', async () => {
    const { project, enqueued, send } = setup()
    const response = await send('GET', `/projects/${project.id}/sfx/suggestions`)
    expect(response.status).toBe(200)
    const { data } = await json<Ok<{ kind: string; reason: string; cue: { startSec: number } }[]>>(response)
    expect(data.map((s) => [s.kind, s.cue.startSec])).toEqual([
      ['impact', 1],
      ['whoosh', 3.6],
    ])
    expect(data[0]?.reason).toBe('フラッシュに合わせた衝撃音')
    expect(enqueued).toEqual([])
  })

  it('無い作品は 404', async () => {
    const { send } = setup()
    expect((await send('GET', '/projects/01ARZ3NDEKTSV4RRFFQ69G5FAV/sfx/suggestions')).status).toBe(404)
  })
})

describe('chooseSfxModel', () => {
  it('お試し・口の無い AI は「選ばれていない」、有効にしていない AI はそう言う（設定の名前は出さない）', () => {
    const models = { stable_audio_sfx: 'sfx_api/stable-audio-3-sfx', moss_sfx: 'sfx_api/moss-sfx-v2' }
    expect(chooseSfxModel('stub', models)).toEqual({ state: 'unavailable', reason: NO_SFX_AI_MESSAGE })
    expect(chooseSfxModel('ace_step', models)).toEqual({ state: 'unavailable', reason: NO_SFX_AI_MESSAGE })
    const disabled = chooseSfxModel('stable_audio_sfx', { stable_audio_sfx: null })
    expect(disabled.state === 'unavailable' ? disabled.reason : '').toMatch(/Stable Audio 3.*有効になっていません/)
    expect(disabled.state === 'unavailable' ? disabled.reason : '').not.toMatch(/LOCAL_SFX_GENERATOR/)
    expect(chooseSfxModel('stable_audio_sfx', models)).toEqual(READY)
    expect(chooseSfxModel('moss_sfx', models)).toEqual(MOSS)
  })
})
