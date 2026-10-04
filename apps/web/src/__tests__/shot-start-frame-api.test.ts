import { ImageGenerationJobId, ProjectId, ShotId, newId } from '@ixa/domain'
import { afterEach, describe, expect, it } from 'vitest'
import { createRequester } from '@/lib/requester'
import { createShotStartFrameApi } from '@/lib/shot-start-frame-api'

/** 絵を作るのを止める口の契約（制作者 2026-10-04「画像生成も停められるようにしよう」）。ネットワークには出ない。 */

const BASE_URL = 'https://api.test'
const projectId = newId(ProjectId)
const shotId = newId(ShotId)
const jobId = newId(ImageGenerationJobId)
const realFetch = globalThis.fetch

type Captured = { readonly url: string; readonly method: string | undefined; readonly body: string | null }

const withFetch = (payload: unknown): Captured[] => {
  const captured: Captured[] = []
  globalThis.fetch = (input, init) => {
    captured.push({
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : null,
    })
    return Promise.resolve(
      new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
  }
  return captured
}

afterEach(() => {
  globalThis.fetch = realFetch
})

const api = () => createShotStartFrameApi(createRequester(BASE_URL))

describe('cancelImages', () => {
  it('Shot を渡さなければ、作品の絵をすべて止める（空の本文）', async () => {
    const captured = withFetch({ success: true, data: { cancelledJobIds: [jobId] } })

    const result = await api().cancelImages(projectId)

    expect(captured[0]).toMatchObject({ url: `${BASE_URL}/projects/${projectId}/images/cancel`, method: 'POST' })
    expect(JSON.parse(captured[0]?.body ?? 'null')).toEqual({})
    expect(result.cancelledJobIds).toEqual([jobId])
  })

  it('Shot を渡せば、その Shot の絵だけ止める', async () => {
    const captured = withFetch({ success: true, data: { cancelledJobIds: [] } })

    await api().cancelImages(projectId, [shotId])

    expect(JSON.parse(captured[0]?.body ?? 'null')).toEqual({ shotIds: [shotId] })
  })
})
