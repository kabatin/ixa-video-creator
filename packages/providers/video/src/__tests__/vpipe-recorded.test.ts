import { ProviderBusyError, type ProviderJobHandle } from '@ixa/provider-core'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vpipeH3TurboDraftModel } from '../vpipe/descriptor.js'
import { createTempDir, makeSpec, removeTempDir } from './fixtures.js'
import {
  BASE_URL,
  bytesResponse,
  createFetch,
  jsonResponse,
  leaksSecret,
  makeVpipeProvider,
  MP4_BYTES,
  REAL_BUSY_BODY,
  REAL_BUSY_RETRY_AFTER,
  REAL_JOB_ID,
  REAL_SUCCEEDED_JOB,
  serverRoutes,
  vpipeRequestFor,
} from './vpipe-fixtures.js'

let outputDir = ''
beforeEach(async () => {
  outputDir = await createTempDir()
})
afterEach(async () => {
  await removeTempDir(outputDir)
})

/**
 * 実サーバ（vpipe-api 0.1.0）から取った応答での契約テスト。文書の例と実物の食い違いをここで拾う。
 */
describe('実サーバの応答', () => {
  it('成功したジョブを取り込める（時刻はマイクロ秒まで入る）', async () => {
    const handle: ProviderJobHandle = {
      providerId: vpipeH3TurboDraftModel.providerId,
      modelId: vpipeH3TurboDraftModel.id,
      ref: REAL_JOB_ID,
      submittedAt: new Date('2026-09-30T05:17:23Z'),
    }
    const { fetch } = createFetch((url) =>
      url === `${BASE_URL}/v1/jobs/${REAL_JOB_ID}/output`
        ? bytesResponse(MP4_BYTES, 'video/mp4')
        : jsonResponse(200, REAL_SUCCEEDED_JOB),
    )

    const status = await makeVpipeProvider(fetch, outputDir).poll(handle)

    expect(status.state).toBe('succeeded')
    if (status.state !== 'succeeded') return
    expect(status.output).toEqual({ type: 'local', path: join(outputDir, `${REAL_JOB_ID}.mp4`) })
    expect(status.seedUsed).toBe(120698028)
    expect(status.costUsd).toBe(0)
    expect(status.raw).toMatchObject({
      quality: 'draft',
      output: { width: 1280, height: 720, frames: 56, fps: 24, durationSec: 2.333 },
      generation: { width: 832, height: 480, frames: 56, steps: 6, quality: 'draft' },
    })
    expect(status.raw.renderSec).toBeCloseTo(207.871, 2)
    expect(leaksSecret(JSON.stringify(status.raw))).toBe(false)
  })

  it('満杯の 429 は ProviderBusyError で、Retry-After（175 秒）を運ぶ', async () => {
    const { fetch } = createFetch(
      serverRoutes({
        submit: () => jsonResponse(429, REAL_BUSY_BODY, { 'retry-after': REAL_BUSY_RETRY_AFTER }),
      }),
    )
    const result = await makeVpipeProvider(fetch, outputDir)
      .submit(vpipeRequestFor(makeSpec({ durationSec: 2.2 }), vpipeH3TurboDraftModel))
      .catch((error: unknown) => error)

    expect(result).toBeInstanceOf(ProviderBusyError)
    expect((result as ProviderBusyError).retryAfterMs).toBe(175_000)
  })
})
