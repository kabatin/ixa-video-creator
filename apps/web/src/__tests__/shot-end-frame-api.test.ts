import { MediaAssetId, ShotId, newId } from '@ixa/domain'
import { afterEach, describe, expect, it } from 'vitest'
import { createRequester } from '@/lib/requester'
import { createShotEndFrameApi } from '@/lib/shot-end-frame-api'

/** 終わりの画像の口の契約（道・メソッド・返りの読み方）。ネットワークには出ない。 */

const BASE_URL = 'https://api.test'
const shotId = newId(ShotId)
const assetId = newId(MediaAssetId)
const realFetch = globalThis.fetch

type Captured = { readonly url: string; readonly method: string | undefined; readonly body: string | null }

const withFetch = (payload: unknown, status = 200): Captured[] => {
  const captured: Captured[] = []
  globalThis.fetch = (input, init) => {
    captured.push({
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : null,
    })
    return Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }),
    )
  }
  return captured
}

afterEach(() => {
  globalThis.fetch = realFetch
})

const api = () => createShotEndFrameApi(createRequester(BASE_URL))

describe('createShotEndFrameApi', () => {
  it('getEndFrame は GET で読み、付いていなければ null', async () => {
    const captured = withFetch({ success: true, data: { mediaAssetId: null } })

    const result = await api().getEndFrame(shotId)

    expect(captured[0]).toMatchObject({ url: `${BASE_URL}/shots/${shotId}/end-frame`, method: 'GET' })
    expect(result.mediaAssetId).toBeNull()
  })

  it('setEndFrame は PUT で画像を送り、替わった時間の合わせ方を読む', async () => {
    const captured = withFetch({ success: true, data: { mediaAssetId: assetId, timing: 'fit' } })

    const result = await api().setEndFrame(shotId, assetId)

    expect(captured[0]).toMatchObject({ url: `${BASE_URL}/shots/${shotId}/end-frame`, method: 'PUT' })
    expect(JSON.parse(captured[0]?.body ?? 'null')).toEqual({ mediaAssetId: assetId })
    expect(result).toEqual({ mediaAssetId: assetId, timing: 'fit' })
  })

  it('知らない合わせ方が返ったら読まずに断る', async () => {
    withFetch({ success: true, data: { mediaAssetId: assetId, timing: 'stretch' } })

    await expect(api().setEndFrame(shotId, assetId)).rejects.toThrow()
  })

  it('clearEndFrame は DELETE（204）', async () => {
    const captured = withFetch(null, 204)

    await api().clearEndFrame(shotId)

    expect(captured[0]).toMatchObject({ url: `${BASE_URL}/shots/${shotId}/end-frame`, method: 'DELETE' })
  })
})
