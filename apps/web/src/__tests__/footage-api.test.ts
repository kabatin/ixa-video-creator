import { MediaAssetId, ProjectId, ShotId, Take, WorkspaceId } from '@ixa/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@/lib/api-client'
import type { UploadMediaParams } from '@/lib/upload-api'
import { importFootageFiles, type FootageImportApi, type ImportTakeBody } from '@/lib/footage-api'
import { MEDIA_ID, PROJECT_ID, SHOT_ID, WORKSPACE_ID, takeJson } from './fixtures'

/** 手持ちの動画を Take にする（ADR-0026）。 */

const BASE_URL = 'http://127.0.0.1:3001'
const shotId = ShotId.parse(SHOT_ID)
const mediaId = MediaAssetId.parse(MEDIA_ID)

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const fetchMock = vi.fn<typeof fetch>()

const urlOf = (input: Parameters<typeof fetch>[0] | undefined): string =>
  input === undefined ? '' : typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

const bodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const importedTakeJson = {
  ...takeJson,
  providerId: 'import',
  modelId: 'import/footage',
  providerParams: { kind: 'import', sourceModel: null, fileName: 'a.mp4' },
}

describe('importTake', () => {
  it('Shot の取り込み口へ送り、返った Take を検証する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: importedTakeJson }, 201))

    const take = await createApiClient(BASE_URL).importTake(shotId, {
      mediaAssetId: mediaId,
      sourceModel: null,
      fileName: 'a.mp4',
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(urlOf(url)).toBe(`${BASE_URL}/shots/${SHOT_ID}/takes/import`)
    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({ mediaAssetId: MEDIA_ID, sourceModel: null, fileName: 'a.mp4' })
    expect(take.providerParams.kind).toBe('import')
  })

  it('空のモデル名は送る前に null にする（空白だけの名前を残さない）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: importedTakeJson }, 201))

    await createApiClient(BASE_URL).importTake(shotId, { mediaAssetId: mediaId, sourceModel: '  ', fileName: null })

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(bodyOf(init)).toMatchObject({ sourceModel: null })
  })
})

describe('mediaDurationSec', () => {
  it('素材の長さ（probe）を返す。まだ分からなければ null', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: MEDIA_ID, probe: { durationSec: 6.04 } } }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: MEDIA_ID, probe: null } }))
    const client = createApiClient(BASE_URL)

    expect(await client.mediaDurationSec(mediaId)).toBe(6.04)
    expect(await client.mediaDurationSec(mediaId)).toBeNull()
    expect(urlOf(fetchMock.mock.calls[0]?.[0])).toBe(`${BASE_URL}/media/${MEDIA_ID}`)
  })
})

describe('importFootageFiles', () => {
  const fakeApi = (): FootageImportApi & { readonly uploaded: string[] } => {
    const uploaded: string[] = []
    return {
      uploaded,
      uploadMedia: vi.fn((file: File, params: UploadMediaParams) => {
        uploaded.push(`${file.name}:${params.kind}`)
        return Promise.resolve({ id: `asset-${file.name}` } as never)
      }),
      importTake: vi.fn((_shot: ShotId, body: ImportTakeBody) =>
        Promise.resolve(Take.parse({ ...importedTakeJson, mediaAssetId: mediaId, createdAt: new Date(), providerParams: { kind: 'import', sourceModel: body.sourceModel ?? null, fileName: body.fileName } })),
      ),
    }
  }

  it('1 本ずつ動画として上げ、同じ Shot の Take にする（元のファイル名を残す）', async () => {
    const api = fakeApi()
    const files = [new File(['a'], 'a.mp4', { type: 'video/mp4' }), new File(['b'], 'b.mov', { type: 'video/quicktime' })]

    const takes = await importFootageFiles(
      api,
      { shotId, workspaceId: WorkspaceId.parse(WORKSPACE_ID), projectId: ProjectId.parse(PROJECT_ID) },
      files,
      'Kling 3.0',
    )

    expect(api.uploaded).toEqual(['a.mp4:video', 'b.mov:video'])
    expect(api.importTake).toHaveBeenNthCalledWith(1, shotId, { mediaAssetId: 'asset-a.mp4', sourceModel: 'Kling 3.0', fileName: 'a.mp4' })
    expect(takes).toHaveLength(2)
  })
})
