import { ProjectId, RenderJobId, ThumbnailId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_ID, PROJECT_ID } from '@/__tests__/fixtures'
import { createRenderFolderApi } from '@/lib/render-folder-api'
import { createRequester } from '@/lib/requester'
import { createThumbnailApi, isKeyArtActive, isThumbnailSettled } from '@/lib/thumbnail-api'

/** サムネイルとキーアートの呼び出し口（ADR-0051）。送る形と、受け取りの検証を固定する。 */

const BASE_URL = 'http://127.0.0.1:3001'
const THUMBNAIL_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC1'
const JOB_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC2'

const projectId = ProjectId.parse(PROJECT_ID)

const thumbnailJson = {
  id: THUMBNAIL_ID,
  projectId: PROJECT_ID,
  spec: {
    background: { kind: 'timeline_frame', atSec: 3.5 },
    zoom: 1,
    focusX: 0.5,
    focusY: 0.5,
    title: '新曲',
    subtitle: null,
    layout: 'left',
    titleColor: '#ffffff',
    accentColor: '#ffcc00',
    font: 'gothic',
  },
  status: 'done',
  outputAssetId: MEDIA_ID,
  fileName: 'iXA サムネ 2026-10-17 10.00.00.jpg',
  error: null,
  createdAt: '2026-10-17T01:00:00.000Z',
  finishedAt: '2026-10-17T01:00:05.000Z',
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const bodyOf = (call: number): unknown => {
  const init = fetchMock.mock.calls[call]?.[1]
  return typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
}
const urlOf = (call: number): string => {
  const input = fetchMock.mock.calls[call]?.[0]
  if (input === undefined) return ''
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

const fetchMock = vi.fn<typeof fetch>()
const api = () => createThumbnailApi(createRequester(BASE_URL))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('サムネイルの書き出し', () => {
  it('仕様は既定値を埋めてから送る', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { thumbnailId: THUMBNAIL_ID } }, 202))
    const id = await api().startThumbnail(projectId, { background: { kind: 'timeline_frame', atSec: 2 }, title: ' 新曲 ' })
    expect(id).toBe(THUMBNAIL_ID)
    expect(urlOf(0)).toBe(`${BASE_URL}/projects/${PROJECT_ID}/thumbnails`)
    expect(bodyOf(0)).toMatchObject({ spec: { title: '新曲', zoom: 1, layout: 'left', subtitle: null } })
  })

  it('破れた仕様は送らない（題名が長すぎる）', async () => {
    await expect(
      api().startThumbnail(projectId, { background: { kind: 'timeline_frame', atSec: 2 }, title: 'あ'.repeat(41) }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('1 件と一覧を読む。日時は Date になる', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: thumbnailJson }))
    const one = await api().getThumbnail(ThumbnailId.parse(THUMBNAIL_ID))
    expect(one.createdAt).toBeInstanceOf(Date)
    expect(urlOf(0)).toBe(`${BASE_URL}/thumbnails/${THUMBNAIL_ID}`)

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [thumbnailJson] }))
    expect(await api().listThumbnails(projectId)).toHaveLength(1)
  })

  it('知らない状態は受け取らない', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ...thumbnailJson, status: 'succeeded' } }))
    await expect(api().getThumbnail(ThumbnailId.parse(THUMBNAIL_ID))).rejects.toThrow()
  })

  it('終わった（成功・失敗）かを見分ける', () => {
    expect(isThumbnailSettled({ status: 'done' })).toBe(true)
    expect(isThumbnailSettled({ status: 'failed' })).toBe(true)
    expect(isThumbnailSettled({ status: 'rendering' })).toBe(false)
  })
})

describe('キーアート', () => {
  it('枚数と指示を送る。空の指示は送らない', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ success: true, data: { jobIds: [JOB_ID] } }, 202)))
    expect(await api().generateKeyArt(projectId, { count: 2, instruction: ' 夕焼け ' })).toEqual([JOB_ID])
    expect(urlOf(0)).toBe(`${BASE_URL}/projects/${PROJECT_ID}/key-art/generate`)
    expect(bodyOf(0)).toEqual({ count: 2, instruction: '夕焼け' })

    await api().generateKeyArt(projectId, { count: 1, instruction: '  ' })
    expect(bodyOf(1)).toEqual({ count: 1 })
  })

  it('枚数は 1〜4 枚。外れたら送らない', async () => {
    await expect(api().generateKeyArt(projectId, { count: 5, instruction: '' })).rejects.toThrow()
    await expect(api().generateKeyArt(projectId, { count: 0, instruction: '' })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ジョブの一覧を読み、動いているものを見分ける', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          { id: JOB_ID, status: 'running', instruction: null, mediaAssetId: null, error: null, queuedAt: '2026-10-17T01:00:00.000Z', finishedAt: null },
        ],
      }),
    )
    const [job] = await api().listKeyArt(projectId)
    expect(job !== undefined && isKeyArtActive(job)).toBe(true)
    expect(isKeyArtActive({ status: 'succeeded' })).toBe(false)
  })
})

describe('書き出しフォルダを開く', () => {
  const opened = { success: true, data: { location: '~/Movies/ixa', copied: 0, failed: [] } }

  it('サムネイルを選んで開くときは thumbnailId を送る', async () => {
    fetchMock.mockResolvedValue(jsonResponse(opened))
    await createRenderFolderApi(createRequester(BASE_URL)).openRenderFolder(projectId, {
      thumbnailId: ThumbnailId.parse(THUMBNAIL_ID),
    })
    expect(bodyOf(0)).toEqual({ thumbnailId: THUMBNAIL_ID })
  })

  it('動画の書き出しは今までどおり renderJobId、無ければ空', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(opened)))
    const folder = createRenderFolderApi(createRequester(BASE_URL))
    await folder.openRenderFolder(projectId, RenderJobId.parse(JOB_ID))
    await folder.openRenderFolder(projectId)
    expect(bodyOf(0)).toEqual({ renderJobId: JOB_ID })
    expect(bodyOf(1)).toEqual({})
  })
})
