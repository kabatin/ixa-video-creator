import { OpenAPIHono } from '@hono/zod-openapi'
import type { MusicJobId } from '@ixa/domain'
import { createInMemoryMusicJobRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import type { MusicGenerationDeps } from '../music/deps.js'
import { chooseMusicModel, NO_MUSIC_AI_MESSAGE, type MusicModelChoice } from '../music/music-model.js'
import { musicGenerateRoutes } from '../routes/music-generate.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectEvents } from './in-memory-project-events.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 曲を作る（ADR-0048）。ジョブを作って worker の `music` キューへ入れる（作るのは worker）。
 * 範囲は ace-step-api の契約と同じ。曲の AI がお試し・この環境で使えないときは頼まない。
 */

type Ok<T> = { success: true; data: T }
type Err = { success: false; error: string; fields?: Record<string, string[]> }

const READY: MusicModelChoice = { state: 'ready', tool: 'ace_step', model: 'ace_step/ace-step-1.5' }
const STABLE_AUDIO: MusicModelChoice = {
  state: 'ready',
  tool: 'stable_audio_medium_music',
  model: 'sfx_api/stable-audio-3-medium-music',
}

const setup = (options: { readonly choice?: MusicModelChoice; readonly enqueueFails?: boolean } = {}) => {
  const project = aProject()
  const enqueued: MusicJobId[] = []
  const events = createInMemoryProjectEvents()
  const musicJobs = createInMemoryMusicJobRepository()
  const logger = createLogger('silent')
  const deps = {
    projects: createInMemoryProjectRepository([project]),
    musicJobs,
    musicModel: () => Promise.resolve(options.choice ?? READY),
    musicQueue: {
      enqueue: (id: MusicJobId) => {
        if (options.enqueueFails === true) return Promise.reject(new Error('Redis に繋がりません'))
        enqueued.push(id)
        return Promise.resolve()
      },
    },
    events,
    logger,
  } satisfies MusicGenerationDeps
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', musicGenerateRoutes(deps))
  registerErrorHandlers(app, logger)
  const send = (method: string, path: string, payload?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
  return { project, enqueued, events, musicJobs, send }
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

describe('POST /projects/{projectId}/music/generate', () => {
  it('ジョブを作ってキューへ入れ、出来事を流す（省略した値は既定）', async () => {
    const { project, enqueued, events, musicJobs, send } = setup()

    const response = await send('POST', `/projects/${project.id}/music/generate`, { prompt: 'j-pop, upbeat' })

    expect(response.status).toBe(202)
    const { data } = await json<Ok<{ jobId: string }>>(response)
    expect(enqueued).toEqual([data.jobId])
    expect(musicJobs.snapshot()[0]).toMatchObject({
      tool: 'ace_step',
      model: 'ace_step/ace-step-1.5',
      status: 'queued',
      spec: { prompt: 'j-pop, upbeat', lyrics: '', durationSec: 60, instrumental: false, seed: null, count: 1, title: null },
    })
    expect(events.published()).toMatchObject([{ type: 'music_job.status', jobId: data.jobId, status: 'queued' }])
  })

  it('指定した値をそのまま記す', async () => {
    const { project, musicJobs, send } = setup()
    const response = await send('POST', `/projects/${project.id}/music/generate`, {
      prompt: 'rock',
      lyrics: '[chorus]\nいけ',
      durationSec: 240,
      instrumental: true,
      seed: 7,
      count: 4,
      title: 'テーマ',
    })
    expect(response.status).toBe(202)
    expect(musicJobs.snapshot()[0]?.spec).toEqual({
      prompt: 'rock',
      lyrics: '[chorus]\nいけ',
      durationSec: 240,
      instrumental: true,
      seed: 7,
      count: 4,
      title: 'テーマ',
    })
  })

  it.each([
    ['曲調が空', { prompt: '  ' }, 'prompt'],
    ['曲調が無い', {}, 'prompt'],
    ['曲調が 1000 字を超える', { prompt: 'a'.repeat(1001) }, 'prompt'],
    ['歌詞が 4000 字を超える', { prompt: 'x', lyrics: 'あ'.repeat(4001) }, 'lyrics'],
    ['長さが 9 秒', { prompt: 'x', durationSec: 9 }, 'durationSec'],
    ['長さが 241 秒', { prompt: 'x', durationSec: 241 }, 'durationSec'],
    ['曲の数が 5', { prompt: 'x', count: 5 }, 'count'],
    ['曲の数が 0', { prompt: 'x', count: 0 }, 'count'],
    ['種が負', { prompt: 'x', seed: -1 }, 'seed'],
  ] as const)('%s は 422（頼まない）', async (_label, payload, field) => {
    const { project, enqueued, send } = setup()
    const response = await send('POST', `/projects/${project.id}/music/generate`, payload)
    expect(response.status).toBe(422)
    expect((await json<Err>(response)).fields?.[field]).toBeDefined()
    expect(enqueued).toEqual([])
  })

  it('曲の AI がお試し・この環境で使えないときは 409 で理由を言う（頼まない）', async () => {
    const { project, enqueued, send } = setup({ choice: { state: 'unavailable', reason: NO_MUSIC_AI_MESSAGE } })
    const response = await send('POST', `/projects/${project.id}/music/generate`, { prompt: 'x' })
    expect(response.status).toBe(409)
    expect((await json<Err>(response)).error).toBe(NO_MUSIC_AI_MESSAGE)
    expect(enqueued).toEqual([])
  })

  /** ADR-0048 追記。Stable Audio は歌なしの BGM だけ・190 秒まで。歌を黙って捨てない。 */
  it('Stable Audio を選んでいれば、歌なし・歌詞なし・190 秒までをそのモデルで記す', async () => {
    const { project, enqueued, musicJobs, send } = setup({ choice: STABLE_AUDIO })
    const response = await send('POST', `/projects/${project.id}/music/generate`, {
      prompt: 'lofi hip hop, mellow piano',
      instrumental: true,
      durationSec: 190,
    })
    expect(response.status).toBe(202)
    expect(enqueued).toHaveLength(1)
    expect(musicJobs.snapshot()[0]).toMatchObject({
      tool: 'stable_audio_medium_music',
      model: 'sfx_api/stable-audio-3-medium-music',
      spec: { instrumental: true, lyrics: '', durationSec: 190 },
    })
  })

  it.each([
    ['歌あり', { instrumental: false }, /歌なしの曲だけ/],
    ['歌詞あり', { instrumental: true, lyrics: '[verse]\nはしれ' }, /歌詞は使えません/],
    ['190 秒を超える', { instrumental: true, durationSec: 190.5 }, /10〜190 秒/],
  ] as const)('Stable Audio に %s を頼むと 409 で理由を言う（頼まない）', async (_label, body, message) => {
    const { project, enqueued, musicJobs, send } = setup({ choice: STABLE_AUDIO })
    const response = await send('POST', `/projects/${project.id}/music/generate`, { prompt: 'x', ...body })
    expect(response.status).toBe(409)
    expect((await json<Err>(response)).error).toMatch(message)
    expect(enqueued).toEqual([])
    expect(musicJobs.snapshot()).toEqual([])
  })

  it('ACE-Step なら歌あり・240 秒も今までどおり受ける', async () => {
    const { project, send } = setup()
    const response = await send('POST', `/projects/${project.id}/music/generate`, {
      prompt: 'j-pop',
      lyrics: '[verse]\nはしれ',
      durationSec: 240,
    })
    expect(response.status).toBe(202)
  })

  it('無い作品は 404', async () => {
    const { send } = setup()
    expect((await send('POST', '/projects/01ARZ3NDEKTSV4RRFFQ69G5FAV/music/generate', { prompt: 'x' })).status).toBe(404)
  })

  it('キューへ入れ損ねたら失敗にしてから 500（待っているまま残さない）', async () => {
    const { project, musicJobs, events, send } = setup({ enqueueFails: true })
    const response = await send('POST', `/projects/${project.id}/music/generate`, { prompt: 'x' })
    expect(response.status).toBe(500)
    expect(musicJobs.snapshot()[0]).toMatchObject({ status: 'failed', error: { code: 'enqueue_failed' } })
    expect(events.published()).toMatchObject([{ type: 'music_job.status', status: 'failed' }])
  })
})

describe('ジョブの状態・記録・取り消し', () => {
  it('GET /music-jobs/{id} は状態を返し、無ければ 404', async () => {
    const { project, send } = setup()
    const created = await json<Ok<{ jobId: string }>>(
      await send('POST', `/projects/${project.id}/music/generate`, { prompt: 'x', count: 2 }),
    )
    const response = await send('GET', `/music-jobs/${created.data.jobId}`)
    expect(response.status).toBe(200)
    expect((await json<Ok<unknown>>(response)).data).toMatchObject({
      id: created.data.jobId,
      status: 'queued',
      prompt: 'x',
      count: 2,
      musicTrackIds: [],
      error: null,
    })
    expect((await send('GET', '/music-jobs/01ARZ3NDEKTSV4RRFFQ69G5FAV')).status).toBe(404)
  })

  it('作品の記録は新しい順。止めると待っているものが止まり、出来事を流す', async () => {
    const { project, events, send } = setup()
    for (const prompt of ['一曲目', '二曲目']) await send('POST', `/projects/${project.id}/music/generate`, { prompt })

    const recent = await json<Ok<{ prompt: string }[]>>(await send('GET', `/projects/${project.id}/music-jobs`))
    expect(recent.data.map((job) => job.prompt)).toEqual(['二曲目', '一曲目'])

    const cancelled = await send('POST', `/projects/${project.id}/music-jobs/cancel`)
    expect(cancelled.status).toBe(200)
    expect((await json<Ok<{ cancelledJobIds: string[] }>>(cancelled)).data.cancelledJobIds).toHaveLength(2)
    expect(events.published().filter((event) => event.type === 'music_job.status' && event.status === 'cancelled')).toHaveLength(2)
  })
})

describe('chooseMusicModel', () => {
  it('お試し・口の無い AI は「選ばれていない」、有効にしていない AI はそう言う', () => {
    expect(chooseMusicModel('stub', { ace_step: 'm' })).toEqual({ state: 'unavailable', reason: NO_MUSIC_AI_MESSAGE })
    expect(chooseMusicModel('klein', { ace_step: 'm' })).toEqual({ state: 'unavailable', reason: NO_MUSIC_AI_MESSAGE })
    const disabled = chooseMusicModel('ace_step', { ace_step: null })
    expect(disabled).toMatchObject({ state: 'unavailable' })
    expect(disabled.state === 'unavailable' ? disabled.reason : '').toMatch(/ACE-Step.*有効になっていません/)
    expect(disabled.state === 'unavailable' ? disabled.reason : '').not.toMatch(/LOCAL_MUSIC_GENERATOR/)
    expect(chooseMusicModel('ace_step', { ace_step: 'ace_step/ace-step-1.5' })).toEqual(READY)
  })
})
