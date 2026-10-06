import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ProviderError, type ProviderJobHandle, type ProviderJobStatus } from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VPIPE_IDENTITY, vpipeH3TurboModel } from '../vpipe/descriptor.js'
import { wasNeverSent } from '../local-server/http.js'
import { localServerNoResponseCode, localServerUnreachableCode } from '../local-server/identity.js'
import { saveOutputAtomically } from '../local-server/output.js'
import { createVpipeVideoProvider } from '../vpipe/provider.js'
import { BodyTooLargeError, pumpWithLimit } from '../local-server/stream.js'
import { createTempDir, removeTempDir } from './fixtures.js'
import {
  BASE_URL,
  createFetch,
  JOB_ID,
  jsonResponse,
  OUTPUT_URL,
  stallingResponse,
  SUCCEEDED_JOB,
  truncatedResponse,
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

const pollWith = async (handler: Handler, timeoutMs = 60_000) => {
  const { fetch } = createFetch(handler)
  const provider = createVpipeVideoProvider({ baseUrl: BASE_URL, outputDir, fetch, timeoutMs })
  return (await provider.poll(HANDLE).catch((error: unknown) => error)) as ProviderJobStatus | Error
}

const stream = (bytes: readonly number[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes))
      controller.close()
    },
  })

/**
 * 本文が読めなかったのは通信の失敗であって、応答の形の違いではない。
 * 形の違い（終端の失敗）として扱うと、サーバの再起動 1 回で長い生成を捨ててしまう。
 */
describe('本文の途中で切れた・時間切れの応答', () => {
  it('問い合わせの本文が途中で切れたら（abort ではない）、やり直せる失敗として投げる', async () => {
    const result = await pollWith(() => truncatedResponse(200))
    expect(result).toBeInstanceOf(ProviderError)
    expect(result).toMatchObject({ code: localServerNoResponseCode(VPIPE_IDENTITY), retryable: true })
  })

  it('問い合わせの本文が止まったら、時間切れでやり直せる失敗として投げる', async () => {
    const result = await pollWith((_url, init) => stallingResponse(init, 'application/json'), 50)
    expect(result).toMatchObject({ code: localServerNoResponseCode(VPIPE_IDENTITY), retryable: true })
  })

  it('出力の本文が止まったら、時間切れで投げ、書きかけも最終の名前も残さない', async () => {
    const result = await pollWith(
      (url, init) =>
        url === OUTPUT_URL ? stallingResponse(init, 'video/mp4') : jsonResponse(200, SUCCEEDED_JOB),
      50,
    )
    expect(result).toMatchObject({ code: 'vpipe_output_unsaved', retryable: true })
    expect(await readdir(outputDir)).not.toContain(`${JOB_ID}.mp4`)
    expect(await readdir(join(outputDir, '.tmp'))).toEqual([])
  })
})

describe('問い合わせたのと別のジョブの応答', () => {
  it('自分のものとして取り込まず、やり直せない失敗にする', async () => {
    const result = await pollWith(() =>
      jsonResponse(200, { ...SUCCEEDED_JOB, id: 'job_SOMEONEELSE0000000000000' }),
    )
    expect(result).toMatchObject({
      state: 'failed',
      error: { code: 'vpipe_invalid_response', retryable: false },
    })
    expect(await readdir(outputDir)).toEqual([])
  })
})

describe('出力の保存の上限と後始末', () => {
  it('上限を超えたら止めて投げ、書きかけを消す', async () => {
    await expect(
      saveOutputAtomically(outputDir, JOB_ID, stream([1, 2, 3, 4, 5, 6]), 4),
    ).rejects.toBeInstanceOf(BodyTooLargeError)
    expect(await readdir(outputDir)).toEqual(['.tmp'])
    expect(await readdir(join(outputDir, '.tmp'))).toEqual([])
  })

  it('上限ちょうどまでは保存する', async () => {
    const saved = await saveOutputAtomically(outputDir, JOB_ID, stream([1, 2, 3, 4]), 4)
    expect(saved).toEqual({ path: join(outputDir, `${JOB_ID}.mp4`), bytes: 4 })
  })

  it('書き手が失敗したら読み取りを取り消す（接続を握ったまま放置しない）', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
      cancel() {
        cancelled = true
      },
    })
    await expect(
      pumpWithLimit(body, 1024, () => {
        throw new Error('ディスクがいっぱい')
      }),
    ).rejects.toThrow('ディスクがいっぱい')
    expect(cancelled).toBe(true)
  })
})

describe('届いたかどうかの見分け', () => {
  const refused = (code: string) =>
    new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })

  it('接続拒否・名前が引けない・経路が無い・接続の時間切れは「届いていない」', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']) {
      expect(wasNeverSent(refused(code))).toBe(true)
    }
  })

  it('IPv4 と IPv6 の両方で拒まれた（AggregateError）も「届いていない」', () => {
    const both = new TypeError('fetch failed', {
      cause: Object.assign(
        new AggregateError([
          Object.assign(new Error('v6'), { code: 'ECONNREFUSED' }),
          Object.assign(new Error('v4'), { code: 'ECONNREFUSED' }),
        ]),
        { code: 'ECONNREFUSED' },
      ),
    })
    expect(wasNeverSent(both)).toBe(true)
  })

  it('切断・時間切れ・分からないものは「届いたかもしれない」に倒す', () => {
    expect(wasNeverSent(refused('UND_ERR_SOCKET'))).toBe(false)
    expect(wasNeverSent(new DOMException('timed out', 'TimeoutError'))).toBe(false)
    expect(wasNeverSent(new Error('?'))).toBe(false)
    expect(wasNeverSent('string')).toBe(false)
  })

  it('コードの名前は 2 通り', () => {
    expect(localServerUnreachableCode(VPIPE_IDENTITY)).toBe('vpipe_unreachable')
    expect(localServerNoResponseCode(VPIPE_IDENTITY)).toBe('vpipe_no_response')
  })
})
