import { createHash } from 'node:crypto'
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  CharacterId,
  DUB_GENERATING_REASON,
  DUB_IN_PROGRESS_REASON,
  DUB_NO_AUDIO_REASON,
  DUB_NO_DIALOGUE_REASON,
  MediaAsset,
  MediaAssetId,
  newId,
  type MediaProbe,
} from '@ixa/domain'
import {
  aShot,
  aTake,
  createInMemoryCharacterRepository,
  createInMemoryDubJobRepository,
  createInMemoryMediaAssetRepository,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
  createInMemoryVoiceProfileRepository,
} from '@ixa/generation/testing'
import { VoiceProviderError } from '@ixa/provider-core'
import type { DesignVoiceRequest } from '@ixa/provider-voice'
import { createMemoryStorage } from '@ixa/storage'
import { describe, expect, it } from 'vitest'
import type { VoiceDesignPort } from '../dub/deps.js'
import { dubRouter } from '../dub/mount.js'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { VOICE_DESIGN_UNAVAILABLE_MESSAGE } from '../routes/character-voice-design.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * 声の差し替えの口（ADR-0062 段 5b）。積むだけで、差し替えるのは worker。断る理由は domain の `dubBlocker`。
 * 説明から声を作る口は、偽の Voice Design で確かめる（実の Gemini は呼ばない）。
 */

const SPEAKER = CharacterId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1')
const line = { speakerId: SPEAKER, text: 'こんにちは', offscreen: false, translation: null }

const assetWith = (projectId: string, workspaceId: string, probe: MediaProbe | null) =>
  MediaAsset.parse({
    id: newId(MediaAssetId),
    workspaceId,
    projectId,
    kind: 'video',
    storageKey: 'media/w/a/original.mp4',
    mimeType: 'video/mp4',
    bytes: 1,
    checksumSha256: 'a'.repeat(64),
    probe,
    proxyKey: null,
    thumbnailKey: null,
    origin: { type: 'upload', uploadedBy: 'test' },
    createdAt: new Date(0),
  })

const PROBE: MediaProbe = { durationSec: 3, width: 160, height: 120, fps: 24, hasAudio: true, codec: 'h264' }

type Setup = {
  readonly shot?: Parameters<typeof aShot>[1]
  readonly probe?: MediaProbe | null
  readonly design?: VoiceDesignPort | null
  readonly enqueue?: () => Promise<void>
}

const setup = async (options: Setup = {}) => {
  const project = aProject()
  const base = aShot(project.id, { dialogue: [line], ...options.shot })
  const asset = assetWith(project.id, project.workspaceId, options.probe === undefined ? PROBE : options.probe)
  const takes = createInMemoryTakeRepository()
  const source = await takes.create(aTake(base, 'a'.repeat(64), { mediaAssetId: asset.id }))
  const shot = { ...base, selectedTakeId: options.shot?.selectedTakeId === null ? null : source.id }
  const shots = createInMemoryShotRepository([shot])
  const dubJobs = createInMemoryDubJobRepository()
  const characters = createInMemoryCharacterRepository()
  const voices = createInMemoryVoiceProfileRepository()
  const mediaAssets = createInMemoryMediaAssetRepository([asset])
  const storage = createMemoryStorage()
  const cat = await characters.create({ workspaceId: project.workspaceId, projectId: project.id, name: 'neko', displayName: 'ネコ' })
  const enqueued: string[] = []
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route(
    '/',
    dubRouter({
      projects: createInMemoryProjectRepository([project]),
      shots,
      takes,
      mediaAssets,
      dubJobs,
      dubQueue: {
        enqueue:
          options.enqueue ??
          ((id) => {
            enqueued.push(id)
            return Promise.resolve()
          }),
      },
      characters,
      voices,
      storage,
      voiceDesign: options.design === undefined ? null : options.design,
      logger: createLogger('silent'),
    }),
  )
  registerErrorHandlers(app, createLogger('silent'))
  const deps = {
    projects: createInMemoryProjectRepository([project]),
    shots,
    takes,
    mediaAssets,
    dubJobs,
    dubQueue: {
      enqueue: (id: string) => {
        enqueued.push(id)
        return Promise.resolve()
      },
    },
    characters,
    voices,
    storage,
    voiceDesign: options.design === undefined ? null : options.design,
    logger: createLogger('silent'),
  }
  return { app, project, shot, source, dubJobs, enqueued: () => enqueued, cat, voices, mediaAssets, storage, deps }
}

/** 同じ表で、ジョブの口の一部だけを差し替えた app（同時に押されたときの再現）。 */
const setupWith = (
  f: Awaited<ReturnType<typeof setup>>,
  patch: Partial<Awaited<ReturnType<typeof setup>>['dubJobs']>,
  others: Partial<Parameters<typeof dubRouter>[0]> = {},
) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', dubRouter({ ...f.deps, dubJobs: { ...f.dubJobs, ...patch }, ...others }))
  registerErrorHandlers(app, createLogger('silent'))
  return app
}

const post = (app: OpenAPIHono, path: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

type Body<T> = { readonly success: boolean; readonly data: T; readonly error?: string }
type Job = { readonly id: string; readonly status: string; readonly sourceTakeId: string; readonly projectId: string }

describe('POST /shots/:shotId/dub', () => {
  it('採用中の Take を元にジョブを積み、202 を返す。状態の口と動いている一覧に出る', async () => {
    const f = await setup()
    const res = await post(f.app, `/shots/${f.shot.id}/dub`)
    expect(res.status).toBe(202)
    const job = ((await res.json()) as Body<Job>).data
    expect(job).toMatchObject({ status: 'queued', sourceTakeId: f.source.id, projectId: f.project.id })
    expect(f.enqueued()).toEqual([job.id])

    const state = ((await (await f.app.request(`/shots/${f.shot.id}/dub`)).json()) as Body<{ blocker: string | null; latestJob: Job | null }>).data
    expect(state.blocker).toBe(DUB_IN_PROGRESS_REASON)
    expect(state.latestJob?.id).toBe(job.id)
    const active = ((await (await f.app.request(`/projects/${f.project.id}/dubs/active`)).json()) as Body<readonly Job[]>).data
    expect(active.map((j) => j.id)).toEqual([job.id])
    expect(((await (await f.app.request(`/dub-jobs/${job.id}`)).json()) as Body<Job>).data.id).toBe(job.id)
  })

  it('差し替えている最中・動画を作っている最中は 409', async () => {
    const f = await setup()
    await post(f.app, `/shots/${f.shot.id}/dub`)
    const again = await post(f.app, `/shots/${f.shot.id}/dub`)
    expect(again.status).toBe(409)
    expect(((await again.json()) as Body<null>).error).toBe(DUB_IN_PROGRESS_REASON)

    const g = await setup({ shot: { status: 'generating' } })
    const res = await post(g.app, `/shots/${g.shot.id}/dub`)
    expect(res.status).toBe(409)
    expect(((await res.json()) as Body<null>).error).toBe(DUB_GENERATING_REASON)
    expect(g.enqueued()).toEqual([])
  })

  it('同時に押されて表の一意で落ちたら 409（2 本目は積まない）', async () => {
    const f = await setup()
    // 1 本目が積まれた直後に 2 本目が来た（2 本目の確かめの時点では、まだ 1 本目が見えていない）。
    await f.dubJobs.create({ projectId: f.project.id, shotId: f.shot.id, sourceTakeId: f.source.id })
    const racing = setupWith(f, { findActiveByProject: () => Promise.resolve([]) })
    const res = await post(racing, `/shots/${f.shot.id}/dub`)
    expect(res.status).toBe(409)
    expect(((await res.json()) as Body<null>).error).toBe(DUB_IN_PROGRESS_REASON)
    expect(f.dubJobs.snapshot()).toHaveLength(1)
    expect(f.enqueued()).toEqual([])
  })

  it('セリフが無い・音が無い Take は 422（理由つき）。積まない', async () => {
    const noLines = await setup({ shot: { dialogue: [] } })
    const res = await post(noLines.app, `/shots/${noLines.shot.id}/dub`)
    expect(res.status).toBe(422)
    expect(((await res.json()) as Body<null>).error).toBe(DUB_NO_DIALOGUE_REASON)
    const silent = await setup({ probe: { ...PROBE, hasAudio: false } })
    const res2 = await post(silent.app, `/shots/${silent.shot.id}/dub`)
    expect(res2.status).toBe(422)
    expect(((await res2.json()) as Body<null>).error).toBe(DUB_NO_AUDIO_REASON)
    expect(silent.dubJobs.snapshot()).toEqual([])
  })

  it('順番に入れ損ねたら、ジョブを失敗にしてから 500（「差し替えている」のまま残さない）', async () => {
    const f = await setup({ enqueue: () => Promise.reject(new Error('Redis が無い')) })
    expect((await post(f.app, `/shots/${f.shot.id}/dub`)).status).toBe(500)
    expect(f.dubJobs.snapshot().map((j) => j.status)).toEqual(['failed'])
  })

  it('取り消すと止まり、もう一度押せる', async () => {
    const f = await setup()
    const job = ((await (await post(f.app, `/shots/${f.shot.id}/dub`)).json()) as Body<Job>).data
    const cancelled = ((await (await post(f.app, `/dub-jobs/${job.id}/cancel`)).json()) as Body<Job>).data
    expect(cancelled.status).toBe('cancelled')
    expect((await post(f.app, `/shots/${f.shot.id}/dub`)).status).toBe(202)
  })

  it('無いジョブ・無い Shot は 404', async () => {
    const f = await setup()
    expect((await f.app.request('/dub-jobs/01ARZ3NDEKTSV4RRFFQ69G5FAV')).status).toBe(404)
    expect((await post(f.app, '/shots/01ARZ3NDEKTSV4RRFFQ69G5FAV/dub')).status).toBe(404)
  })
})

const WAV = Buffer.from('RIFF....WAVEfmt fake sample')

const fakeDesign = (result: () => Promise<{ voiceId: string; sampleWav: Buffer | null }>) => {
  let calls: readonly DesignVoiceRequest[] = []
  const port: VoiceDesignPort = {
    keyLabel: 'key2-2026-10-14',
    designVoice: (request) => {
      calls = [...calls, request]
      return result()
    },
  }
  return { port, calls: () => calls }
}

describe('POST /characters/:id/voices/design', () => {
  const body = { description: '落ち着いた低めの声の老紳士', gender: 'male', displayName: 'ネコの声（作った）' }

  it('説明から声を作り、名札つきでそのキャラクターの声として保存し、試し聞きを素材にして返す', async () => {
    const design = fakeDesign(() => Promise.resolve({ voiceId: 'voice_abc123', sampleWav: WAV }))
    const f = await setup({ design: design.port })
    const res = await post(f.app, `/characters/${f.cat.id}/voices/design`, body)
    expect(res.status).toBe(201)
    const data = ((await res.json()) as Body<{ voice: { id: string; voiceName: string; characterId: string; tool: string; designedVoice: unknown }; sampleMediaAssetId: string | null }>).data
    expect(data.voice).toMatchObject({
      voiceName: 'voice_abc123',
      characterId: f.cat.id,
      tool: 'gemini_api',
      designedVoice: { description: body.description, gender: 'male', keyLabel: 'key2-2026-10-14' },
    })
    expect(design.calls()).toEqual([{ description: body.description, gender: 'male', displayName: body.displayName, languageCode: 'ja-JP' }])
    const asset = await f.mediaAssets.findById(data.sampleMediaAssetId as never)
    expect(asset?.origin).toEqual({ type: 'voice_design', voiceProfileId: data.voice.id })
    expect(Buffer.from(await f.storage.get(asset?.storageKey ?? ''))).toEqual(WAV)
  })

  it('作る口が無ければ 503（呼ばない）。同じ名前の声があれば 409（呼ばない）', async () => {
    const none = await setup({ design: null })
    const res = await post(none.app, `/characters/${none.cat.id}/voices/design`, body)
    expect(res.status).toBe(503)
    expect(((await res.json()) as Body<null>).error).toBe(VOICE_DESIGN_UNAVAILABLE_MESSAGE)

    const design = fakeDesign(() => Promise.resolve({ voiceId: 'voice_x', sampleWav: null }))
    const f = await setup({ design: design.port })
    await f.voices.create({ projectId: f.project.id, name: body.displayName, tool: 'gemini_api', voiceName: 'Kore' })
    expect((await post(f.app, `/characters/${f.cat.id}/voices/design`, body)).status).toBe(409)
    expect(design.calls()).toEqual([])
  })

  it('入力を確かめる（空の説明・知らない性別・長すぎる名前・知らない欄は 422）', async () => {
    const design = fakeDesign(() => Promise.resolve({ voiceId: 'voice_x', sampleWav: null }))
    const f = await setup({ design: design.port })
    for (const bad of [
      { ...body, description: ' ' },
      { ...body, gender: 'other' },
      { ...body, displayName: 'あ'.repeat(41) },
      { ...body, description: 'あ'.repeat(1001) },
      { ...body, keyLabel: 'mine' },
    ]) {
      expect((await post(f.app, `/characters/${f.cat.id}/voices/design`, bad)).status).toBe(422)
    }
    expect(design.calls()).toEqual([])
  })

  it('作っている間に同じ名前の声ができていても、払った声を失わず「（2）」を付けて保存する', async () => {
    const design = fakeDesign(() => Promise.resolve({ voiceId: 'voice_abc123', sampleWav: null }))
    const f = await setup({ design: design.port })
    // 名前の確かめは通り、保存の時点で同じ名前が先に入った（同時に作った）。
    let first = true
    const racingVoices = {
      ...f.voices,
      create: (input: Parameters<typeof f.voices.create>[0]) => {
        if (first) {
          first = false
          return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }))
        }
        return f.voices.create(input)
      },
    }
    const app = setupWith(f, {}, { voices: racingVoices })
    const res = await post(app, `/characters/${f.cat.id}/voices/design`, body)
    expect(res.status).toBe(201)
    expect(((await res.json()) as Body<{ voice: { name: string; voiceName: string } }>).data.voice).toMatchObject({
      name: `${body.displayName}（2）`,
      voiceName: 'voice_abc123',
    })
    expect(design.calls()).toHaveLength(1)
  })

  it('同じキャラクターで作っている最中にもう一度押されたら 429（二重に払わない）', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const design = fakeDesign(async () => {
      await gate
      return { voiceId: 'voice_slow', sampleWav: null }
    })
    const f = await setup({ design: design.port })
    const firstRes = post(f.app, `/characters/${f.cat.id}/voices/design`, body)
    const second = await post(f.app, `/characters/${f.cat.id}/voices/design`, { ...body, displayName: '別の名前' })
    expect(second.status).toBe(429)
    release()
    expect((await firstRes).status).toBe(201)
    expect(design.calls()).toHaveLength(1)
    // 終われば、また作れる。
    expect((await post(f.app, `/characters/${f.cat.id}/voices/design`, { ...body, displayName: '三つ目' })).status).toBe(201)
  })

  it('試し聞きと同じ中身の素材が別の作品にあれば指さない（保存せず、声は保存する）', async () => {
    const design = fakeDesign(() => Promise.resolve({ voiceId: 'voice_abc123', sampleWav: WAV }))
    const f = await setup({ design: design.port })
    const foreign = assetWith('01ARZ3NDEKTSV4RRFFQ69G5FAW', '01ARZ3NDEKTSV4RRFFQ69G5FAX', null)
    const theirs = { ...foreign, kind: 'audio' as const, checksumSha256: createHash('sha256').update(WAV).digest('hex') }
    const app = setupWith(f, {}, { mediaAssets: createInMemoryMediaAssetRepository([theirs]) })
    const res = await post(app, `/characters/${f.cat.id}/voices/design`, body)
    expect(res.status).toBe(201)
    const data = ((await res.json()) as Body<{ sampleMediaAssetId: string | null }>).data
    expect(data.sampleMediaAssetId).toBeNull()
  })

  it('Gemini が断ったら 502 で理由を返し、声は保存しない', async () => {
    const design = fakeDesign(() => Promise.reject(new VoiceProviderError('rate_limited', 'Gemini の回数の上限に当たりました', true)))
    const f = await setup({ design: design.port })
    const res = await post(f.app, `/characters/${f.cat.id}/voices/design`, body)
    expect(res.status).toBe(502)
    expect(((await res.json()) as Body<null>).error).toContain('Gemini の回数の上限に当たりました')
    expect(await f.voices.findByProject(f.project.id)).toEqual([])
  })
})
