import { MusicTrackId, ProjectId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MEDIA_ID,
  MUSIC_TRACK_ID,
  PROJECT_ID,
  SEQUENCE_ID,
  shotJson,
} from '@/__tests__/fixtures'
import { createApiClient } from '@/lib/api-client'

const BASE_URL = 'http://127.0.0.1:3001'

const projectId = ProjectId.parse(PROJECT_ID)
const musicTrackId = MusicTrackId.parse(MUSIC_TRACK_ID)

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const requestBodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined

const trackJson = {
  id: MUSIC_TRACK_ID,
  projectId: PROJECT_ID,
  mediaAssetId: MEDIA_ID,
  title: 'iXA CUP MUSIC VIDEO',
  isMaster: true,
  offsetSec: 0,
  volume: 1,
}

const analysisJson = {
  musicTrackId: MUSIC_TRACK_ID,
  analyzerVersion: 'librosa-v1',
  durationSec: 116,
  bpm: 120,
  bpmConfidence: 0.95,
  beats: [0, 0.5, 1],
  downbeats: [0, 2],
  sections: [{ start: 0, end: 116, label: 'intro', energy: 0.4 }],
  onsets: [0.01],
  drops: [32],
  waveformPeaksUrl: 'https://example.invalid/peaks.json?sig=x',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('楽曲の一覧', () => {
  it('projectId で引き、封筒を剥がしてパースする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [trackJson] }))

    const tracks = await createApiClient(BASE_URL).listMusicTracks(projectId)

    expect(tracks).toHaveLength(1)
    expect(tracks[0]?.title).toBe('iXA CUP MUSIC VIDEO')
    expect(tracks[0]?.isMaster).toBe(true)

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/music-tracks`)
  })
})

describe('解析結果の取得', () => {
  it('署名付き URL を含む解析結果を返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: analysisJson }))

    const analysis = await createApiClient(BASE_URL).getAnalysis(musicTrackId)

    expect(analysis?.bpm).toBe(120)
    expect(analysis?.sections).toHaveLength(1)
    expect(analysis?.waveformPeaksUrl).toContain('peaks.json')
  })

  it('未解析（404）は null に畳む。解析前でも画面を出せるようにするため', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: 'この楽曲はまだ解析されていません' }, 404),
    )

    await expect(createApiClient(BASE_URL).getAnalysis(musicTrackId)).resolves.toBeNull()
  })

  it('404 以外の失敗は握り潰さず投げる', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'boom' }, 500))

    await expect(createApiClient(BASE_URL).getAnalysis(musicTrackId)).rejects.toThrow()
  })
})

describe('解析の起動', () => {
  it('本文なしで POST し、受け付けられたことを返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { musicTrackId: MUSIC_TRACK_ID, queued: true } }),
    )

    const accepted = await createApiClient(BASE_URL).requestAnalysis(musicTrackId)

    expect(accepted.queued).toBe(true)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/music-tracks/${MUSIC_TRACK_ID}/analysis`)
    expect(init?.method).toBe('POST')
    expect(requestBodyOf(init)).toBeUndefined()
  })
})

describe('Shot の一括作成', () => {
  it('入力をそのまま送り、作られた Shot と warning を返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          shots: [shotJson],
          requestedCount: 8,
          createdCount: 4,
          section: { index: 1, label: 'chorus' },
          warnings: ['このセクションのグリッドでは 4 カットが上限です（8 カット要求）'],
        },
      }),
    )

    const result = await createApiClient(BASE_URL).allocateShots(projectId, {
      musicTrackId,
      sectionIndex: 1,
      requestedCount: 8,
      subdivision: 0.5,
      sequenceId: null,
    })

    expect(result.createdCount).toBe(4)
    expect(result.shots).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/storyboard/shots`)
    expect(requestBodyOf(init)).toEqual({
      musicTrackId: MUSIC_TRACK_ID,
      sectionIndex: 1,
      requestedCount: 8,
      subdivision: 0.5,
      sequenceId: null,
    })
  })

  it('warning が無ければ空配列で返す', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          shots: [shotJson],
          requestedCount: 1,
          createdCount: 1,
          section: { index: 0, label: 'intro' },
          warnings: [],
        },
      }),
    )

    const result = await createApiClient(BASE_URL).allocateShots(projectId, {
      musicTrackId,
      sectionIndex: 0,
      requestedCount: 1,
      subdivision: 1,
      sequenceId: null,
    })

    expect(result.warnings).toEqual([])
  })
})

describe('Sequence の一覧', () => {
  it('projectId で引く', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          {
            id: SEQUENCE_ID,
            projectId: PROJECT_ID,
            order: 0,
            name: 'サビ',
            musicSectionLabel: 'chorus',
          },
        ],
      }),
    )

    const sequences = await createApiClient(BASE_URL).listSequences(projectId)

    expect(sequences[0]?.name).toBe('サビ')

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/sequences`)
  })
})
