import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAssetId } from '@ixa/domain'
import { ProviderError, type ProviderJobHandle, type ProviderJobStatus } from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vpipeH3TurboModel } from '../vpipe/descriptor.js'
import { createTempDir, makeSpec, removeTempDir } from './fixtures.js'
import {
  bytesResponse,
  CANCELED_JOB,
  connectionRefused,
  createFetch,
  errorEnvelope,
  failedJob,
  JOB_ID,
  JOB_URL,
  jsonResponse,
  leaksSecret,
  makeVpipeProvider,
  MP4_BYTES,
  OUTPUT_URL,
  QUEUED_JOB,
  RUNNING_JOB,
  serverRoutes,
  SUBMIT_BODY,
  SUCCEEDED_JOB,
  TOKEN,
  vpipeRequestFor,
  type Handler,
} from './vpipe-fixtures.js'

let outputDir = ''
beforeEach(async () => {
  outputDir = await createTempDir()
})
afterEach(async () => {
  await removeTempDir(outputDir)
})

const HANDLE: ProviderJobHandle = {
  providerId: vpipeH3TurboModel.providerId,
  modelId: vpipeH3TurboModel.id,
  ref: JOB_ID,
  submittedAt: new Date('2026-09-30T12:00:00Z'),
}

/** 状態の問い合わせと出力の取得を振り分ける。 */
const serving =
  (job: unknown, output: () => Response = () => bytesResponse(MP4_BYTES, 'video/mp4')): Handler =>
  (url) =>
    url === OUTPUT_URL ? output() : jsonResponse(200, job)

const pollWith = async (handler: Handler, handle: ProviderJobHandle = HANDLE) => {
  const { calls, fetch } = createFetch(handler)
  const provider = makeVpipeProvider(fetch, outputDir, TOKEN)
  const result = await provider.poll(handle).catch((error: unknown) => error)
  return { calls, result: result as ProviderJobStatus | Error }
}

const succeeded = (result: ProviderJobStatus | Error) => {
  if (result instanceof Error || result.state !== 'succeeded') {
    throw new Error(`成功していない: ${JSON.stringify(result)}`)
  }
  return result
}

describe('poll — 状態の写し方', () => {
  it('queued は pending（待ち順は進み具合にしない）', async () => {
    const { calls, result } = await pollWith(serving(QUEUED_JOB))
    expect(result).toEqual({ state: 'pending', progress: null })
    expect(calls[0]).toMatchObject({ url: JOB_URL, method: 'GET' })
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('running は running（0..1 の進み具合をそのまま運ぶ）', async () => {
    expect((await pollWith(serving(RUNNING_JOB))).result).toEqual({
      state: 'running',
      progress: 0.4,
    })
    expect((await pollWith(serving({ ...RUNNING_JOB, progress: null }))).result).toEqual({
      state: 'running',
      progress: null,
    })
  })

  it('failed はサーバの理由と retryable を運ぶ', async () => {
    const { result } = await pollWith(
      serving(
        failedJob({
          code: 'server_restarted',
          message: 'server restarted while running',
          retryable: true,
        }),
      ),
    )
    expect(result).toMatchObject({
      state: 'failed',
      error: { code: 'vpipe_server_restarted', retryable: true },
    })
    expect((result as Extract<ProviderJobStatus, { state: 'failed' }>).error.message).toContain(
      'server restarted while running',
    )
  })

  it('理由の無い failed も空にせず、やり直せない失敗にする', async () => {
    const { result } = await pollWith(serving(failedJob(null)))
    expect(result).toMatchObject({
      state: 'failed',
      error: { code: 'vpipe_generation_failed', retryable: false },
    })
    expect(
      (result as Extract<ProviderJobStatus, { state: 'failed' }>).error.message.length,
    ).toBeGreaterThan(0)
  })

  it('canceled はやり直せない失敗', async () => {
    const { result } = await pollWith(serving(CANCELED_JOB))
    expect(result).toMatchObject({
      state: 'failed',
      error: { code: 'vpipe_canceled', retryable: false },
    })
  })

  it('知らない状態は pending へ丸めず失敗させる', async () => {
    const { result } = await pollWith(serving({ ...QUEUED_JOB, status: 'ascended' }))
    expect(result).toMatchObject({
      state: 'failed',
      error: { code: 'vpipe_invalid_response', retryable: false },
    })
  })

  it('succeeded なのに result が無ければ、出力の無い成功にしない', async () => {
    const { result } = await pollWith(serving({ ...SUCCEEDED_JOB, result: null }))
    expect(result).toMatchObject({ state: 'failed', error: { code: 'vpipe_invalid_response' } })
  })
})

describe('poll — 問い合わせそのものの失敗は投げる（worker が予約し直せるように）', () => {
  it('5xx と接続断はやり直せる ProviderError', async () => {
    const server = await pollWith(() => jsonResponse(503, errorEnvelope('internal', true)))
    const down = await pollWith(() => connectionRefused())
    expect(server.result).toBeInstanceOf(ProviderError)
    expect((server.result as ProviderError).retryable).toBe(true)
    expect(down.result).toMatchObject({ code: 'vpipe_unreachable', retryable: true })
  })

  it('401 と 404 はやり直せない ProviderError', async () => {
    const auth = await pollWith(() => jsonResponse(401, errorEnvelope('unauthorized', false)))
    const missing = await pollWith(() => jsonResponse(404, errorEnvelope('not_found', false)))
    expect(auth.result).toMatchObject({ code: 'vpipe_unauthorized', retryable: false })
    expect(missing.result).toMatchObject({ code: 'vpipe_not_found', retryable: false })
  })

  it('壊れたジョブ参照は HTTP を叩かずに落とす', async () => {
    const { calls, result } = await pollWith(serving(QUEUED_JOB), {
      ...HANDLE,
      ref: '../../etc/passwd',
    })
    expect(result).toBeInstanceOf(ProviderError)
    expect((result as ProviderError).retryable).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('poll — 完了したら出力を手元のファイルにする', () => {
  it('mp4 を <outputDir>/<ジョブ ID>.mp4 に置き、local で返す（SSRF 検査に掛からない）', async () => {
    const { calls, result } = await pollWith(serving(SUCCEEDED_JOB))
    const status = succeeded(result)

    const expected = join(outputDir, `${JOB_ID}.mp4`)
    expect(status.output).toEqual({ type: 'local', path: expected })
    expect(new Uint8Array(await readFile(expected))).toEqual(MP4_BYTES)
    expect(calls.map((c) => c.url)).toEqual([JOB_URL, OUTPUT_URL])
    expect(calls[1]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    // 書きかけは残さない。
    expect(await readdir(join(outputDir, '.tmp'))).toEqual([])
  })

  it('seed はサーバが使った値、費用は 0', async () => {
    const status = succeeded((await pollWith(serving(SUCCEEDED_JOB))).result)
    expect(status.seedUsed).toBe(12345)
    expect(status.costUsd).toBe(0)
  })

  it('raw にサーバの実測を残し、URL もトークンも入れない', async () => {
    const status = succeeded((await pollWith(serving(SUCCEEDED_JOB))).result)
    expect(status.raw).toMatchObject({
      provider: 'vpipe',
      modelId: vpipeH3TurboModel.id,
      workflow: 'minimax-h3-turbo-video',
      jobId: JOB_ID,
      quality: 'standard',
      steps: 6,
      audio: false,
      output: {
        mediaType: 'video/mp4',
        width: 1920,
        height: 1080,
        frames: 124,
        fps: 24,
        durationSec: 5.167,
      },
      generation: { width: 1024, height: 576, frames: 124, steps: 6, quality: 'standard' },
      renderSec: 429,
    })
    expect(leaksSecret(JSON.stringify(status.raw))).toBe(false)
  })

  it('同じジョブを 2 度問い合わせても出力は 1 度しか取り寄せない', async () => {
    const first = await pollWith(serving(SUCCEEDED_JOB))
    const second = await pollWith(
      serving(SUCCEEDED_JOB, () => jsonResponse(500, errorEnvelope('internal', true))),
    )

    expect(succeeded(second.result).output).toEqual(succeeded(first.result).output)
    expect(second.calls.map((c) => c.url)).toEqual([JOB_URL])
    expect((await readdir(outputDir)).filter((name) => name.endsWith('.mp4'))).toEqual([
      `${JOB_ID}.mp4`,
    ])
  })

  it('出力の取得が 5xx ならやり直せる失敗として投げ、半端なファイルを残さない', async () => {
    const { result } = await pollWith(
      serving(SUCCEEDED_JOB, () => jsonResponse(500, errorEnvelope('internal', true))),
    )
    expect(result).toBeInstanceOf(ProviderError)
    expect((result as ProviderError).retryable).toBe(true)
    expect(await readdir(outputDir)).not.toContain(`${JOB_ID}.mp4`)
  })

  it('本文が途中で切れたら、最終の名前にも書きかけにも何も残さない', async () => {
    const broken = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]))
            controller.error(new Error('connection reset'))
          },
        }),
        { headers: { 'content-type': 'video/mp4' } },
      )
    const { result } = await pollWith(serving(SUCCEEDED_JOB, broken))

    expect(result).toMatchObject({ code: 'vpipe_output_unsaved', retryable: true })
    expect(await readdir(outputDir)).not.toContain(`${JOB_ID}.mp4`)
    expect(await readdir(join(outputDir, '.tmp'))).toEqual([])
  })

  it('空の本文は成功にしない', async () => {
    const { result } = await pollWith(
      serving(SUCCEEDED_JOB, () => bytesResponse(new Uint8Array(), 'video/mp4')),
    )
    expect(result).toMatchObject({ code: 'vpipe_output_unsaved' })
    expect(await readdir(outputDir)).not.toContain(`${JOB_ID}.mp4`)
  })

  it('動画でない本文は受け取らない', async () => {
    const { result } = await pollWith(
      serving(SUCCEEDED_JOB, () => bytesResponse(MP4_BYTES, 'text/html')),
    )
    expect(result).toMatchObject({ code: 'vpipe_invalid_response', retryable: false })
  })
})

describe('投入から完了まで — 使った参照と捨てた参照を raw に残す', () => {
  const START = 'asset-start' as MediaAssetId
  const PREVIOUS = 'asset-previous' as MediaAssetId

  const handler: Handler = serverRoutes({
    submit: (url, init) =>
      init.method === 'POST' ? jsonResponse(202, SUBMIT_BODY) : serving(SUCCEEDED_JOB)(url, init),
  })

  it('開始画像にした参照と、枠が無くて使わなかった参照が記録される', async () => {
    const { fetch } = createFetch(handler)
    const provider = makeVpipeProvider(fetch, outputDir)
    const handle = await provider.submit(
      vpipeRequestFor(
        makeSpec({
          resolution: { width: 1920, height: 1080 },
          references: [
            { mediaAssetId: PREVIOUS, role: 'previous_shot_last_frame', weight: 0.8 },
            { mediaAssetId: START, role: 'start_frame', weight: 1 },
          ],
        }),
      ),
    )

    const status = succeeded(await provider.poll(handle))
    expect(status.raw.startImage).toEqual({
      role: 'start_frame',
      mediaAssetId: START,
      mediaType: 'image/png',
    })
    expect(status.raw.ignoredReferences).toEqual([
      { role: 'previous_shot_last_frame', mediaAssetId: PREVIOUS },
    ])
    expect(leaksSecret(JSON.stringify(status.raw))).toBe(false)
  })

  it('控えが無ければ推測で埋めず null にする', async () => {
    const status = succeeded((await pollWith(serving(SUCCEEDED_JOB))).result)
    expect(status.raw.startImage).toBeNull()
    expect(status.raw.ignoredReferences).toBeNull()
  })
})

describe('cancel', () => {
  const cancelWith = async (response: () => Response) => {
    const { calls, fetch } = createFetch(response)
    const provider = makeVpipeProvider(fetch, outputDir)
    const result = await provider.cancel(HANDLE).catch((error: unknown) => error)
    return { calls, result }
  }

  it('DELETE /v1/jobs/{id} を投げる', async () => {
    const { calls, result } = await cancelWith(() =>
      jsonResponse(200, { id: JOB_ID, status: 'canceled' }),
    )
    expect(result).toBeUndefined()
    expect(calls[0]).toMatchObject({ url: JOB_URL, method: 'DELETE' })
  })

  it('409（もう終わっている）と 404（記録が無い）は例外にしない', async () => {
    expect(
      (await cancelWith(() => jsonResponse(409, errorEnvelope('conflict', false)))).result,
    ).toBeUndefined()
    expect(
      (await cancelWith(() => jsonResponse(404, errorEnvelope('not_found', false)))).result,
    ).toBeUndefined()
  })

  it('それ以外の失敗は握り潰さない', async () => {
    const { result } = await cancelWith(() => jsonResponse(500, errorEnvelope('internal', true)))
    expect(result).toBeInstanceOf(ProviderError)
  })
})
