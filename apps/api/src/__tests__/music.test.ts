import { OpenAPIHono } from '@hono/zod-openapi'
import {
  MediaAssetId as MediaAssetIdSchema,
  MusicAnalysis as MusicAnalysisSchema,
  MusicAnalysisId as MusicAnalysisIdSchema,
  MusicTrackId as MusicTrackIdSchema,
  newId,
  type MediaAsset,
  type MusicAnalysis,
  type MusicTrackId,
} from '@ixa/domain'
import { createInMemoryMediaAssetRepository } from '@ixa/generation/testing'
import { createMemoryStorage } from '@ixa/storage'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import {
  musicRoutes,
  ANALYSIS_NOT_FOUND_MESSAGE,
  MISSING_ASSET_MESSAGE,
  NOT_AUDIO_MESSAGE,
  type AnalysisQueue,
  type MusicRoutesDeps,
} from '../routes/music.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import {
  createInMemoryMusicAnalysisRepository,
  type InMemoryMusicAnalysisRepository,
} from './in-memory-music-analysis-repository.js'
import {
  aMediaAsset,
  createInMemoryMusicTrackRepository,
  type InMemoryMusicTrackRepository,
} from './in-memory-timeline-repositories.js'

type SuccessBody<T> = { success: true; data: T }
type ListBody<T> = { success: true; data: T[]; meta: { total: number } }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

type TrackBody = { id: string; projectId: string; mediaAssetId: string; title: string }
type AnalysisBody = {
  musicTrackId: string
  bpm: number
  waveformPeaksUrl: string
  waveformPeaksUrlExpiresInSec: number
  createdAt: string
}

const project = aProject()
const otherProject = aProject({ name: '別の Project' })

/** 楽曲として登録できる音源。kind=audio 以外は API が弾く。 */
const anAudioAsset = (overrides: Partial<MediaAsset> = {}): MediaAsset =>
  aMediaAsset({
    kind: 'audio',
    storageKey: 'media/ws/asset/original.wav',
    mimeType: 'audio/wav',
    ...overrides,
  })

const anAnalysis = (musicTrackId: MusicTrackId): MusicAnalysis =>
  MusicAnalysisSchema.parse({
    id: newId(MusicAnalysisIdSchema),
    musicTrackId,
    analyzerVersion: 'librosa-v1',
    durationSec: 116,
    bpm: 119.9984,
    bpmConfidence: 0.92,
    beats: [0, 0.5, 1],
    downbeats: [0, 2],
    sections: [{ start: 0, end: 116, label: 'intro', energy: 0.4 }],
    energyCurve: { hopSec: 0.05, values: [0, 0.5, 1] },
    onsets: [0.01, 0.51],
    drops: [32.5],
    waveformPeaksKey: 'music/p/t/peaks.json',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })

/** 投入された MusicTrack ID を記録するだけのキュー。Redis には接続しない。 */
const createRecordingQueue = (): AnalysisQueue & { enqueued: () => readonly MusicTrackId[] } => {
  const enqueued: MusicTrackId[] = []
  return {
    enqueued: () => enqueued,
    enqueue: (musicTrackId) => {
      enqueued.push(musicTrackId)
      return Promise.resolve()
    },
  }
}

let musicTracks: InMemoryMusicTrackRepository
let musicAnalyses: InMemoryMusicAnalysisRepository
let queue: ReturnType<typeof createRecordingQueue>
let audioAsset: MediaAsset
let app: OpenAPIHono

const buildApp = (deps: MusicRoutesDeps) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', musicRoutes(deps))
  registerErrorHandlers(app, createLogger('silent'))
  return app
}

const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

const createTrack = async (overrides: Record<string, unknown> = {}): Promise<TrackBody> => {
  const res = await send('POST', `/projects/${project.id}/music-tracks`, {
    mediaAssetId: audioAsset.id,
    title: 'iXA CUP MUSIC VIDEO',
    isMaster: true,
    offsetSec: 0,
    volume: 1,
    ...overrides,
  })
  return (await json<SuccessBody<TrackBody>>(res)).data
}

beforeEach(() => {
  audioAsset = anAudioAsset()
  musicTracks = createInMemoryMusicTrackRepository()
  musicAnalyses = createInMemoryMusicAnalysisRepository()
  queue = createRecordingQueue()
  app = buildApp({
    musicTracks,
    musicAnalyses,
    projects: createInMemoryProjectRepository([project, otherProject]),
    mediaAssets: createInMemoryMediaAssetRepository([audioAsset]),
    storage: createMemoryStorage(),
    queue,
  })
})

describe('楽曲の登録', () => {
  it('201 で登録し、経路の projectId が入る', async () => {
    const res = await send('POST', `/projects/${project.id}/music-tracks`, {
      mediaAssetId: audioAsset.id,
      title: 'iXA CUP MUSIC VIDEO',
      isMaster: true,
      offsetSec: 0,
      volume: 1,
    })

    expect(res.status).toBe(201)
    const body = await json<SuccessBody<TrackBody>>(res)
    expect(body.data.projectId).toBe(project.id)
    expect(body.data.mediaAssetId).toBe(audioAsset.id)
    expect(musicTracks.snapshot()).toHaveLength(1)
  })

  it('存在しない Project には登録できない', async () => {
    const ghost = aProject()
    const res = await send('POST', `/projects/${ghost.id}/music-tracks`, {
      mediaAssetId: audioAsset.id,
      title: 'x',
    })
    expect(res.status).toBe(404)
  })

  it('存在しない MediaAsset は 422 で弾く', async () => {
    const res = await send('POST', `/projects/${project.id}/music-tracks`, {
      mediaAssetId: newId(MediaAssetIdSchema),
      title: 'x',
    })

    expect(res.status).toBe(422)
    const body = await json<ErrorBody>(res)
    expect(body.fields?.mediaAssetId).toEqual([MISSING_ASSET_MESSAGE])
    expect(musicTracks.snapshot()).toHaveLength(0)
  })

  it('音声でない MediaAsset は 422 で弾く（解析が worker まで行ってから落ちるのを防ぐ）', async () => {
    const video = anAudioAsset({ kind: 'video', mimeType: 'video/mp4' })
    app = buildApp({
      musicTracks,
      musicAnalyses,
      projects: createInMemoryProjectRepository([project]),
      mediaAssets: createInMemoryMediaAssetRepository([video]),
      storage: createMemoryStorage(),
      queue,
    })

    const res = await send('POST', `/projects/${project.id}/music-tracks`, {
      mediaAssetId: video.id,
      title: 'x',
    })

    expect(res.status).toBe(422)
    const body = await json<ErrorBody>(res)
    expect(body.fields?.mediaAssetId).toEqual([NOT_AUDIO_MESSAGE])
  })
})

describe('楽曲の一覧', () => {
  it('Project に属する楽曲だけを返す', async () => {
    await createTrack()
    await createTrack({ title: '2 曲目', isMaster: false })

    const res = await send('GET', `/projects/${project.id}/music-tracks`)
    expect(res.status).toBe(200)
    const body = await json<ListBody<TrackBody>>(res)
    expect(body.data).toHaveLength(2)
    expect(body.meta.total).toBe(2)

    const others = await send('GET', `/projects/${otherProject.id}/music-tracks`)
    expect((await json<ListBody<TrackBody>>(others)).data).toHaveLength(0)
  })

  it('存在しない Project は 404', async () => {
    expect((await send('GET', `/projects/${aProject().id}/music-tracks`)).status).toBe(404)
  })
})

describe('解析の起動', () => {
  it('202 を返してキューへ積む（結果は待たない）', async () => {
    const track = await createTrack()

    const res = await send('POST', `/music-tracks/${track.id}/analysis`)

    expect(res.status).toBe(202)
    const body = await json<SuccessBody<{ musicTrackId: string; queued: boolean }>>(res)
    expect(body.data).toEqual({ musicTrackId: track.id, queued: true })
    expect(queue.enqueued()).toEqual([track.id])
  })

  it('解析済みでもキューには積む（冪等判定は worker が持つ）', async () => {
    const track = await createTrack()
    await musicAnalyses.create(anAnalysis(track.id as MusicTrackId))

    expect((await send('POST', `/music-tracks/${track.id}/analysis`)).status).toBe(202)
    expect(queue.enqueued()).toHaveLength(1)
  })

  it('存在しない楽曲は 404 で、キューに積まない', async () => {
    const res = await send('POST', `/music-tracks/${newId(MusicTrackIdSchema)}/analysis`)

    expect(res.status).toBe(404)
    expect(queue.enqueued()).toHaveLength(0)
  })
})

describe('解析結果の取得', () => {
  it('最新の解析を、波形ピークの署名付き URL つきで返す', async () => {
    const track = await createTrack()
    await musicAnalyses.create(anAnalysis(track.id as MusicTrackId))

    const res = await send('GET', `/music-tracks/${track.id}/analysis`)

    expect(res.status).toBe(200)
    const body = await json<SuccessBody<AnalysisBody>>(res)
    expect(body.data.musicTrackId).toBe(track.id)
    expect(body.data.bpm).toBeCloseTo(119.9984)
    expect(body.data.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(body.data.waveformPeaksUrlExpiresInSec).toBeGreaterThan(0)
  })

  it('保存済みのキーではなく、都度発行した URL を返す（期限切れ URL を持ち回らない）', async () => {
    const track = await createTrack()
    await musicAnalyses.create(anAnalysis(track.id as MusicTrackId))

    const res = await send('GET', `/music-tracks/${track.id}/analysis`)
    const body = await json<SuccessBody<AnalysisBody & { waveformPeaksKey?: string }>>(res)

    expect(body.data.waveformPeaksKey).toBeUndefined()
    expect(body.data.waveformPeaksUrl).toContain('music/p/t/peaks.json')
    expect(body.data.waveformPeaksUrl).toContain('op=get')
  })

  it('最後に積まれた解析を返す（手動補正が自動解析に埋もれない）', async () => {
    const track = await createTrack()
    const trackId = track.id as MusicTrackId
    await musicAnalyses.create(anAnalysis(trackId))
    await musicAnalyses.create({ ...anAnalysis(trackId), analyzerVersion: 'manual', bpm: 128 })

    const res = await send('GET', `/music-tracks/${track.id}/analysis`)
    const body = await json<SuccessBody<AnalysisBody & { analyzerVersion: string }>>(res)

    expect(body.data.analyzerVersion).toBe('manual')
    expect(body.data.bpm).toBe(128)
  })

  it('未解析の楽曲は 404 と、その理由を返す', async () => {
    const track = await createTrack()

    const res = await send('GET', `/music-tracks/${track.id}/analysis`)

    expect(res.status).toBe(404)
    expect((await json<ErrorBody>(res)).error).toBe(ANALYSIS_NOT_FOUND_MESSAGE)
  })

  it('存在しない楽曲は 404', async () => {
    expect(
      (await send('GET', `/music-tracks/${newId(MusicTrackIdSchema)}/analysis`)).status,
    ).toBe(404)
  })
})

describe('楽曲を直す・マスターを付け替える・消す（PHASE 8）', () => {
  it('PATCH で題名・オフセット・音量を直す', async () => {
    const track = await createTrack()
    const res = await send('PATCH', `/music-tracks/${track.id}`, { title: '差し替え', volume: 0.5 })
    expect(res.status).toBe(200)
    const body = await json<SuccessBody<TrackBody & { volume: number }>>(res)
    expect(body.data.title).toBe('差し替え')
    expect(body.data.volume).toBe(0.5)
  })

  it('PATCH でマスターは変えられない（422）', async () => {
    const track = await createTrack()
    const res = await send('PATCH', `/music-tracks/${track.id}`, { isMaster: false })
    expect(res.status).toBe(422)
  })

  it('存在しない楽曲の PATCH は 404', async () => {
    const res = await send('PATCH', `/music-tracks/${newId(MusicTrackIdSchema)}`, { title: 'x' })
    expect(res.status).toBe(404)
  })

  it('set-master で付け替え、マスターは常に 1 曲だけ', async () => {
    const first = await createTrack({ title: '1 曲目' })
    const second = await createTrack({ title: '2 曲目', isMaster: false })

    const res = await send('POST', `/music-tracks/${second.id}/set-master`)

    expect(res.status).toBe(200)
    const body = await json<ListBody<TrackBody & { isMaster: boolean }>>(res)
    expect(body.data.filter((track) => track.isMaster).map((track) => track.id)).toEqual([
      second.id,
    ])
    expect(musicTracks.snapshot().find((track) => track.id === first.id)?.isMaster).toBe(false)
  })

  it('マスターを消したら、残りで最初に登録した曲がマスターになる', async () => {
    const first = await createTrack({ title: '1 曲目' })
    const second = await createTrack({ title: '2 曲目', isMaster: false })

    const res = await send('DELETE', `/music-tracks/${first.id}`)

    expect(res.status).toBe(204)
    expect(musicTracks.snapshot().map((track) => [track.id, track.isMaster])).toEqual([
      [second.id, true],
    ])
  })

  it('消した楽曲をもう一度消すと 404', async () => {
    const track = await createTrack()
    await send('DELETE', `/music-tracks/${track.id}`)
    expect((await send('DELETE', `/music-tracks/${track.id}`)).status).toBe(404)
  })
})
