import { MediaAssetId, ProjectId, ShotId, TimelineClipId, TransitionId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_ID, PROJECT_ID, SHOT_ID } from '@/__tests__/fixtures'
import { createRequester } from '@/lib/requester'
import { createTimelineApi } from '@/lib/timeline-api'

const BASE_URL = 'http://127.0.0.1:3001'

const TRANSITION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FG0'
const SHOT_ID_2 = '01ARZ3NDEKTSV4RRFFQ69G5FG1'
const CLIP_ID = '01ARZ3NDEKTSV4RRFFQ69G5FG2'

const projectId = ProjectId.parse(PROJECT_ID)
const transitionId = TransitionId.parse(TRANSITION_ID)
const clipId = TimelineClipId.parse(CLIP_ID)
const fromShotId = ShotId.parse(SHOT_ID)
const toShotId = ShotId.parse(SHOT_ID_2)
const mediaAssetId = MediaAssetId.parse(MEDIA_ID)

const transitionJson = {
  id: TRANSITION_ID,
  projectId: PROJECT_ID,
  fromShotId: SHOT_ID,
  toShotId: SHOT_ID_2,
  type: 'dissolve',
  durationSec: 0.5,
}

const clipJson = {
  id: CLIP_ID,
  projectId: PROJECT_ID,
  track: 'TEXT',
  startSec: 1.5,
  durationSec: 2,
  layer: 0,
  content: { type: 'text', templateKey: 'lower-third', params: {} },
  opacity: 1,
  createdAt: '2026-09-16T01:02:03.000Z',
}

const documentJson = {
  version: 1,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  durationSec: 8,
  video1: [
    {
      shotId: SHOT_ID,
      startSec: 0,
      durationSec: 4,
      mediaUrl: 'https://example.test/take.mp4',
      inSec: 0,
    },
  ],
  transitions: [transitionJson],
  clips: [
    {
      id: CLIP_ID,
      track: 'TEXT',
      startSec: 1.5,
      durationSec: 2,
      layer: 0,
      content: { type: 'text', templateKey: 'lower-third', params: {} },
      opacity: 1,
    },
  ],
  audio: [{ mediaUrl: 'https://example.test/song.mp3', startSec: 0, durationSec: 8, volume: 1 }],
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const requestBodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined

const fetchMock = vi.fn<typeof fetch>()

const api = () => createTimelineApi(createRequester(BASE_URL))

const urlOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.toString() : input.url
}

const lastCall = (): readonly [string, RequestInit | undefined] => {
  const call = fetchMock.mock.calls[0]
  if (call === undefined) throw new Error('fetch が呼ばれていない')
  return [urlOf(call[0]), call[1]]
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TimelineDocument の取得', () => {
  it('プロジェクトのタイムラインを GET して組み立て結果を返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: documentJson }))

    const document = await api().getTimelineDocument(projectId)

    const [url, init] = lastCall()
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/timeline`)
    expect(init?.method).toBe('GET')
    expect(document.video1).toHaveLength(1)
    expect(document.durationSec).toBe(8)
  })

  it('封筒が success でも中身が契約と違えば例外にする', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...documentJson, version: 2 } }),
    )

    await expect(api().getTimelineDocument(projectId)).rejects.toThrow()
  })
})

describe('Transition', () => {
  it('一覧を GET する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [transitionJson] }))

    const transitions = await api().listTransitions(projectId)

    const [url, init] = lastCall()
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/transitions`)
    expect(init?.method).toBe('GET')
    expect(transitions[0]?.type).toBe('dissolve')
  })

  it('作成の本文に projectId を含めない（経路が持つため）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: transitionJson }, 201))

    await api().createTransition(projectId, {
      fromShotId,
      toShotId,
      type: 'dissolve',
      durationSec: 0.5,
    })

    const [url, init] = lastCall()
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/transitions`)
    expect(init?.method).toBe('POST')
    expect(requestBodyOf(init)).toEqual({
      fromShotId: SHOT_ID,
      toShotId: SHOT_ID_2,
      type: 'dissolve',
      durationSec: 0.5,
    })
  })

  it('削除は本文を読まずに DELETE する', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await api().deleteTransition(transitionId)

    const [url, init] = lastCall()
    expect(url).toBe(`${BASE_URL}/transitions/${TRANSITION_ID}`)
    expect(init?.method).toBe('DELETE')
  })
})

describe('TimelineClip', () => {
  it('一覧を GET し、日時を Date にして返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [clipJson] }))

    const clips = await api().listClips(projectId)

    const [url] = lastCall()
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/clips`)
    expect(clips[0]?.createdAt).toBeInstanceOf(Date)
    expect(clips[0]?.createdAt.toISOString()).toBe('2026-09-16T01:02:03.000Z')
  })

  it('track を渡すとクエリで絞り込む', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))

    await api().listClips(projectId, 'TEXT')

    const [url] = lastCall()
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/clips?track=TEXT`)
  })

  it('作成の本文に projectId を含めない', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: clipJson }, 201))

    await api().createClip(projectId, {
      track: 'TEXT',
      startSec: 1.5,
      durationSec: 2,
      layer: 0,
      content: { type: 'text', templateKey: 'lower-third', params: {} },
    })

    const [url, init] = lastCall()
    expect(url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/clips`)
    expect(init?.method).toBe('POST')
    const body = requestBodyOf(init) as Record<string, unknown>
    expect(body.projectId).toBeUndefined()
    expect(body.track).toBe('TEXT')
    expect(body.startSec).toBe(1.5)
  })

  it('media クリップの参照先をそのまま送る', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: clipJson }, 201))

    await api().createClip(projectId, {
      track: 'VIDEO2',
      startSec: 0,
      durationSec: 1,
      layer: 1,
      content: { type: 'media', mediaAssetId, inSec: 0, outSec: 1, volume: 1 },
    })

    const body = requestBodyOf(lastCall()[1]) as { readonly content: Record<string, unknown> }
    expect(body.content.mediaAssetId).toBe(MEDIA_ID)
  })

  it('更新は PATCH で部分的に送る', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ...clipJson, startSec: 3 } }))

    const updated = await api().updateClip(clipId, { startSec: 3 })

    const [url, init] = lastCall()
    expect(url).toBe(`${BASE_URL}/clips/${CLIP_ID}`)
    expect(init?.method).toBe('PATCH')
    expect(requestBodyOf(init)).toEqual({ startSec: 3 })
    expect(updated.startSec).toBe(3)
  })

  it('削除は DELETE する', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await api().deleteClip(clipId)

    const [url, init] = lastCall()
    expect(url).toBe(`${BASE_URL}/clips/${CLIP_ID}`)
    expect(init?.method).toBe('DELETE')
  })
})

describe('失敗の扱い', () => {
  it('404 を null に畳まず例外にする（一覧が空に見えるのを避ける）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'not found' }, 404))

    await expect(api().listClips(projectId)).rejects.toThrow()
  })

  it('500 を例外にする', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'boom' }, 500))

    await expect(api().listTransitions(projectId)).rejects.toThrow()
  })
})
