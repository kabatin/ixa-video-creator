import { WorkspaceId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@/lib/api-client'
import { UploadError, type UploadStage } from '@/lib/upload-error'
import { HELLO_SHA256, MEDIA_ID, WORKSPACE_ID, mediaAssetJson } from '@/__tests__/fixtures'

/**
 * アップロードは「署名発行 → ストレージへ PUT → 完了通知」の 3 段階。
 * どの段階で落ちたかが呼び出し側に伝わることを段階ごとに確かめる。
 */

const BASE_URL = 'http://127.0.0.1:3001'
const UPLOAD_URL = 'https://storage.example.com/media/put?signature=abc'

const workspaceId = WorkspaceId.parse(WORKSPACE_ID)

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const signedResponse = (): Response =>
  jsonResponse({
    success: true,
    data: {
      mediaAssetId: MEDIA_ID,
      storageKey: `media/${WORKSPACE_ID}/${MEDIA_ID}/source.png`,
      uploadUrl: UPLOAD_URL,
      expiresInSec: 900,
    },
  })

const completedResponse = (): Response =>
  jsonResponse({ success: true, data: { ...mediaAssetJson, queued: true } }, 201)

const pngFile = (): File => new File(['hello'], 'takepi.png', { type: 'image/png' })

const requestBodyOf = (init: RequestInit | undefined): string =>
  typeof init?.body === 'string' ? init.body : ''

const fetchMock = vi.fn<typeof fetch>()

const upload = async (): Promise<unknown> =>
  createApiClient(BASE_URL)
    .uploadMedia(pngFile(), { workspaceId, kind: 'image' })
    .catch((cause: unknown) => cause)

const stageOf = (error: unknown): UploadStage | null =>
  error instanceof UploadError ? error.stage : null

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadMedia', () => {
  it('署名 → PUT → 完了通知の順に 3 回だけ呼ぶ', async () => {
    fetchMock
      .mockResolvedValueOnce(signedResponse())
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(completedResponse())

    const asset = await createApiClient(BASE_URL).uploadMedia(pngFile(), {
      workspaceId,
      kind: 'image',
    })

    expect(asset.id).toBe(MEDIA_ID)
    expect(asset.queued).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const [signUrl] = fetchMock.mock.calls[0] ?? []
    expect(signUrl).toBe(`${BASE_URL}/uploads/sign`)

    const [putUrl, putInit] = fetchMock.mock.calls[1] ?? []
    expect(putUrl).toBe(UPLOAD_URL)
    expect(putInit?.method).toBe('PUT')

    const [completeUrl, completeInit] = fetchMock.mock.calls[2] ?? []
    expect(completeUrl).toBe(`${BASE_URL}/uploads/complete`)
    expect(JSON.parse(requestBodyOf(completeInit)) as unknown).toMatchObject({
      mediaAssetId: MEDIA_ID,
      storageKey: `media/${WORKSPACE_ID}/${MEDIA_ID}/source.png`,
      // 実データから計算した sha256 を載せる。API はこれで重複排除する。
      checksumSha256: HELLO_SHA256,
      bytes: 5,
      mimeType: 'image/png',
    })
  })

  it('署名発行の失敗は stage=sign として報告し、PUT へ進まない', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'contentType が kind と整合しません' }, 422),
    )

    const error = await upload()

    expect(stageOf(error)).toBe('sign')
    // 段階は `stage` で検査する。文面は利用者向けなので、内部の呼び名を固定しない。
    expect((error as UploadError).message).toContain('送信の準備')
    expect((error as UploadError).message).not.toContain('署名付き URL')
    expect((error as UploadError).message).toContain('contentType')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ストレージへの PUT の失敗は stage=upload として報告し、完了通知を送らない', async () => {
    fetchMock
      .mockResolvedValueOnce(signedResponse())
      .mockResolvedValueOnce(new Response('AccessDenied', { status: 403 }))

    const error = await upload()

    expect(stageOf(error)).toBe('upload')
    expect((error as UploadError).message).toContain('ファイルの送信')
    expect((error as UploadError).message).not.toContain('ストレージ')
    expect((error as UploadError).message).toContain('403')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('PUT のネットワーク失敗も stage=upload になる', async () => {
    fetchMock
      .mockResolvedValueOnce(signedResponse())
      .mockRejectedValueOnce(new Error('ECONNRESET'))

    const error = await upload()

    expect(stageOf(error)).toBe('upload')
    expect((error as UploadError).message).toContain('ECONNRESET')
  })

  it('完了通知の失敗は stage=complete として報告する', async () => {
    fetchMock
      .mockResolvedValueOnce(signedResponse())
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ success: false, error: 'アップロードされたオブジェクトが見つかりません' }, 404),
      )

    const error = await upload()

    expect(stageOf(error)).toBe('complete')
    expect((error as UploadError).message).toContain('取り込み')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('失敗メッセージに署名付き URL を含めない', async () => {
    fetchMock
      .mockResolvedValueOnce(signedResponse())
      .mockResolvedValueOnce(new Response('AccessDenied', { status: 403 }))

    const error = await upload()

    expect((error as UploadError).message).not.toContain('signature=abc')
  })
})
