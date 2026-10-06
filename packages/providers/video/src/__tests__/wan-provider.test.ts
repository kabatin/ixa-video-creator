import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAssetId } from '@ixa/domain'
import {
  CapabilityViolationError,
  ProviderBusyError,
  ProviderError,
  type ProviderJobHandle,
} from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WAN_TI2V_5B_DRAFT_MODEL_ID, wanTi2v5bDraftModel } from '../wan/descriptor.js'
import { createTempDir, makeSpec, removeTempDir } from './fixtures.js'
import {
  bytesResponse,
  connectionRefused,
  connectionReset,
  createFetch,
  errorEnvelope,
  healthBody,
  jsonResponse,
  MP4_BYTES,
  PNG_BYTES,
} from './local-server-fixtures.js'
import {
  makeWanProvider,
  WAN_CANCELED_JOB,
  WAN_CANCELLED_JOB,
  WAN_HEALTH_URL,
  WAN_JOB_ID,
  WAN_JOB_URL,
  WAN_OUTPUT_URL,
  WAN_QUEUED_JOB,
  WAN_RUNNING_JOB,
  WAN_SUBMIT_BODY,
  WAN_SUBMIT_URL,
  WAN_SUCCEEDED_JOB,
  WAN_TOKEN,
  wanFailedJob,
  wanLeaksSecret,
  wanRequestFor,
  wanServerRoutes,
  wanSubmitCallOf,
} from './wan-fixtures.js'

/**
 * wan-api（Wan 2.2 TI2V-5B）の契約テスト（ADR-0040）。**実サーバもモデルも起動しない。**
 *
 * 投入・問い合わせ・取消・満杯の扱いは MiniMax H3 と同じ共通アダプタを通るので、
 * ここで確かめるのは「Wan として正しく振る舞うか」（ワークフロー名・本文・失敗の code の頭）と、
 * 共通の経路が wan の名乗りでも最後まで通ること。
 */

let outputDir = ''

beforeEach(async () => {
  outputDir = await createTempDir()
})

afterEach(async () => {
  await removeTempDir(outputDir)
})

const handle = (modelId = WAN_TI2V_5B_DRAFT_MODEL_ID): ProviderJobHandle => ({
  providerId: wanTi2v5bDraftModel.providerId,
  modelId,
  ref: WAN_JOB_ID,
  submittedAt: new Date('2026-10-06T12:00:00Z'),
})

const draftSpec = () =>
  makeSpec({
    durationSec: 3.4583333333333335,
    resolution: { width: 1920, height: 1080 },
    seed: 4242,
  })

describe('投入', () => {
  it('wan2.2-ti2v-5b のワークフローへ、尺を秒で送る', async () => {
    const { calls, fetch } = createFetch(
      wanServerRoutes({ submit: () => jsonResponse(202, WAN_SUBMIT_BODY) }),
    )
    const provider = makeWanProvider(fetch, outputDir, WAN_TOKEN)

    const result = await provider.submit(wanRequestFor(draftSpec(), wanTi2v5bDraftModel))

    expect(result).toMatchObject({ providerId: 'wan', modelId: WAN_TI2V_5B_DRAFT_MODEL_ID, ref: WAN_JOB_ID })
    const submit = wanSubmitCallOf(calls)
    expect(submit?.url).toBe(WAN_SUBMIT_URL)
    expect(JSON.parse(submit?.body ?? '{}')).toEqual({
      prompt: 'takepi が勝利する',
      output: { width: 1920, height: 1080 },
      duration_seconds: 3.4583333333333335,
      quality: 'draft',
      seed: 4242,
      start_image: null,
    })
  })

  it('合言葉は Authorization で送る（本文にもクエリにも載せない）', async () => {
    const { calls, fetch } = createFetch(
      wanServerRoutes({ submit: () => jsonResponse(202, WAN_SUBMIT_BODY) }),
    )
    await makeWanProvider(fetch, outputDir, WAN_TOKEN).submit(wanRequestFor(draftSpec()))

    const submit = wanSubmitCallOf(calls)
    expect(submit?.headers.Authorization).toBe(`Bearer ${WAN_TOKEN}`)
    expect(submit?.body).not.toContain(WAN_TOKEN)
    for (const call of calls) expect(call.url).not.toContain(WAN_TOKEN)
  })

  it('冪等キーをヘッダで送り、同じキーの 200（既存のジョブ）も受ける', async () => {
    const { calls, fetch } = createFetch(
      // 2 回目は 200 で同じジョブを返す（新しく作らない）のが契約。
      wanServerRoutes({ submit: () => jsonResponse(200, WAN_SUBMIT_BODY) }),
    )
    const provider = makeWanProvider(fetch, outputDir)

    const first = await provider.submit({ ...wanRequestFor(draftSpec()), idempotencyKey: 'job-01' })
    const second = await provider.submit({ ...wanRequestFor(draftSpec()), idempotencyKey: 'job-01' })

    expect(first.ref).toBe(second.ref)
    expect(wanSubmitCallOf(calls)?.headers['Idempotency-Key']).toBe('job-01')
  })

  it('最初のフレームがあれば base64 にして送る（署名付き URL は送らない）', async () => {
    const { calls, fetch } = createFetch(
      wanServerRoutes({
        submit: () => jsonResponse(202, WAN_SUBMIT_BODY),
        image: () => bytesResponse(PNG_BYTES, 'image/png'),
      }),
    )
    const spec = makeSpec({
      references: [{ mediaAssetId: 'asset-1' as MediaAssetId, role: 'start_frame', weight: 1 }],
    })

    await makeWanProvider(fetch, outputDir).submit(wanRequestFor(spec))

    const body = JSON.parse(wanSubmitCallOf(calls)?.body ?? '{}') as {
      start_image: { data: string; media_type: string }
    }
    expect(body.start_image.media_type).toBe('image/png')
    expect(Buffer.from(body.start_image.data, 'base64')).toEqual(Buffer.from(PNG_BYTES))
    expect(wanSubmitCallOf(calls)?.body).not.toContain('X-Amz')
  })

  it('満杯（429）は失敗にせず、待ち時間を添えて「後で来て」と返す', async () => {
    const { fetch } = createFetch(
      wanServerRoutes({
        submit: () =>
          jsonResponse(429, errorEnvelope('busy', true), { 'retry-after': '175' }),
      }),
    )
    const error = await makeWanProvider(fetch, outputDir)
      .submit(wanRequestFor(draftSpec()))
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderBusyError)
    expect((error as ProviderBusyError).retryAfterMs).toBe(175_000)
    expect((error as ProviderBusyError).providerId).toBe('wan')
  })

  it('空きが無いと分かっていれば、開始画像を取り寄せる前に断る', async () => {
    const { calls, fetch } = createFetch(
      wanServerRoutes({
        submit: () => jsonResponse(202, WAN_SUBMIT_BODY),
        health: () => jsonResponse(200, healthBody(1, 1, 1)),
      }),
    )
    const spec = makeSpec({
      references: [{ mediaAssetId: 'asset-1' as MediaAssetId, role: 'start_frame', weight: 1 }],
    })

    const error = await makeWanProvider(fetch, outputDir)
      .submit(wanRequestFor(spec))
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderBusyError)
    expect(calls.map((call) => call.url)).toEqual([WAN_HEALTH_URL])
  })

  it('応答が失われた投入は、冪等キーがあるときだけ投げ直しに回す', async () => {
    const { fetch } = createFetch(wanServerRoutes({ submit: () => connectionReset() }))
    const provider = makeWanProvider(fetch, outputDir)

    const withKey = await provider
      .submit({ ...wanRequestFor(draftSpec()), idempotencyKey: 'job-01' })
      .catch((e: unknown) => e)
    expect(withKey).toBeInstanceOf(ProviderBusyError)

    const withoutKey = await provider.submit(wanRequestFor(draftSpec())).catch((e: unknown) => e)
    expect(withoutKey).toBeInstanceOf(ProviderError)
    expect(withoutKey).not.toBeInstanceOf(ProviderBusyError)
  })

  it('サーバが起動していなければ、待たせずに「起動を確かめて」と言う', async () => {
    const { fetch } = createFetch(() => connectionRefused())
    const error = await makeWanProvider(fetch, outputDir)
      .submit({ ...wanRequestFor(draftSpec()), idempotencyKey: 'job-01' })
      .catch((e: unknown) => e)

    expect(error).not.toBeInstanceOf(ProviderBusyError)
    expect((error as ProviderError).message).toContain('wan-api')
    expect((error as { code?: string }).code).toBe('wan_unreachable')
  })

  it('能力を超える要求は投げる前に弾く（尺が最長の 1.5 倍を超える）', async () => {
    const { calls, fetch } = createFetch(
      wanServerRoutes({ submit: () => jsonResponse(202, WAN_SUBMIT_BODY) }),
    )
    const error = await makeWanProvider(fetch, outputDir)
      .submit(wanRequestFor(makeSpec({ durationSec: 20 })))
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CapabilityViolationError)
    expect(calls).toEqual([])
  })
})

describe('問い合わせ', () => {
  const pollWith = async (body: unknown, status = 200) => {
    const { fetch } = createFetch(() => jsonResponse(status, body))
    return makeWanProvider(fetch, outputDir).poll(handle())
  }

  it('サーバの中で順番を待っている間は「作成中」にしない', async () => {
    expect(await pollWith(WAN_QUEUED_JOB)).toEqual({ state: 'pending', progress: null })
  })

  it('作り始めたら進み具合を運ぶ', async () => {
    expect(await pollWith(WAN_RUNNING_JOB)).toEqual({ state: 'running', progress: 0.25 })
  })

  it('失敗はサーバの code に wan_ を付け、やり直せるかはサーバの判断に従う', async () => {
    const status = await pollWith(wanFailedJob({ code: 'metal_oom', message: 'out of memory', retryable: true }))
    expect(status).toMatchObject({
      state: 'failed',
      error: { code: 'wan_metal_oom', retryable: true },
    })
  })

  it('理由が空でも失敗の理由を空にしない', async () => {
    const status = await pollWith(wanFailedJob(null))
    expect(status).toMatchObject({ state: 'failed', error: { code: 'wan_generation_failed' } })
    if (status.state === 'failed') expect(status.error.message).not.toBe('')
  })

  it.each([
    ['canceled', WAN_CANCELED_JOB],
    ['cancelled', WAN_CANCELLED_JOB],
  ])('取り消し（%s）は綴りに関わらず取り消しとして終端にする', async (_spelling, body) => {
    expect(await pollWith(body)).toMatchObject({
      state: 'failed',
      error: { code: 'wan_canceled', retryable: false },
    })
  })

  it('形の違う応答を「まだ待ち」へ丸めない（終わらないジョブを回し続けない）', async () => {
    const status = await pollWith({ ...WAN_SUCCEEDED_JOB, result: null })
    expect(status).toMatchObject({ state: 'failed', error: { code: 'wan_invalid_response' } })
  })

  it('別のジョブを指す応答は取り込まない', async () => {
    const status = await pollWith({ ...WAN_RUNNING_JOB, id: 'job_other' })
    expect(status).toMatchObject({ state: 'failed', error: { code: 'wan_invalid_response' } })
  })

  it('問い合わせの HTTP の失敗は投げる（failed を返さない）', async () => {
    const { fetch } = createFetch(() => jsonResponse(503, errorEnvelope('internal', true)))
    const error = await makeWanProvider(fetch, outputDir)
      .poll(handle())
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).retryable).toBe(true)
  })
})

describe('完成', () => {
  const succeed = async () => {
    const { calls, fetch } = createFetch((url) =>
      url === WAN_OUTPUT_URL
        ? bytesResponse(MP4_BYTES, 'video/mp4')
        : jsonResponse(200, WAN_SUCCEEDED_JOB),
    )
    const status = await makeWanProvider(fetch, outputDir, WAN_TOKEN).poll(handle())
    return { status, calls }
  }

  it('出力を手元のファイルとして返す（127.0.0.1 の URL を worker へ渡さない）', async () => {
    const { status } = await succeed()
    expect(status.state).toBe('succeeded')
    if (status.state !== 'succeeded') return
    expect(status.output).toEqual({ type: 'local', path: join(outputDir, `${WAN_JOB_ID}.mp4`) })
    expect(await readFile(status.output.type === 'local' ? status.output.path : '')).toEqual(
      Buffer.from(MP4_BYTES),
    )
  })

  it('同じジョブを 2 度問い合わせても、出力は 1 度しか取り寄せない', async () => {
    const { fetch, calls } = createFetch((url) =>
      url === WAN_OUTPUT_URL
        ? bytesResponse(MP4_BYTES, 'video/mp4')
        : jsonResponse(200, WAN_SUCCEEDED_JOB),
    )
    const provider = makeWanProvider(fetch, outputDir)
    await provider.poll(handle())
    await provider.poll(handle())

    expect(calls.filter((call) => call.url === WAN_OUTPUT_URL)).toHaveLength(1)
  })

  it('費用は 0、seed はサーバが使った値', async () => {
    const { status } = await succeed()
    if (status.state !== 'succeeded') throw new Error('succeeded ではない')
    expect(status.costUsd).toBe(0)
    expect(status.seedUsed).toBe(4242)
  })

  /** H3 と Wan を後で比べるための数字（ADR-0040）。**プロンプトと画像の中身は入れない。** */
  it('比べるための実測を記録に残す（段・出来た尺・順番待ち・生成時間）', async () => {
    const { status } = await succeed()
    if (status.state !== 'succeeded') throw new Error('succeeded ではない')
    expect(status.raw).toMatchObject({
      provider: 'wan',
      modelId: WAN_TI2V_5B_DRAFT_MODEL_ID,
      workflow: 'wan2.2-ti2v-5b',
      quality: 'draft',
      // **サーバが測った値を使う**（時刻の差ではない。時刻の差は問い合わせの間隔の分だけ長く出る）。
      queuedSec: 0.8,
      renderSec: 674.7,
      timings: { queue_seconds: 0.8, backend_seconds: 674.7, sampling_seconds: 378.1 },
      audio: false,
      output: { durationSec: 3.458, frames: 83, fps: 24, width: 1920, height: 1080 },
      // サーバが実際に作った大きさとコマ数（4n+1 の 85 コマを作って 83 コマへ揃えた）。
      generation: { width: 1280, height: 704, frames: 85, quality: 'standard' },
    })
    expect(JSON.stringify(status.raw).length).toBeGreaterThan(0)
    expect(wanLeaksSecret(JSON.stringify(status.raw))).toBe(false)
  })

  /** vpipe-api は `timings` を返さない。返さないサーバでは時刻の差で代わりを出す。 */
  it('サーバが秒数を返さなければ、時刻の差から出す', async () => {
    // 項目ごと無いときの形（vpipe-api は timings を返さない）。元の値は書き換えない。
    const withoutTimings = Object.fromEntries(
      Object.entries(WAN_SUCCEEDED_JOB).filter(([key]) => key !== 'timings'),
    )
    const { fetch } = createFetch((url) =>
      url === WAN_OUTPUT_URL
        ? bytesResponse(MP4_BYTES, 'video/mp4')
        : jsonResponse(200, withoutTimings),
    )
    const status = await makeWanProvider(fetch, outputDir).poll(handle())
    if (status.state !== 'succeeded') throw new Error('succeeded ではない')

    // 12:00:00 → 12:00:30 と 12:00:30 → 12:08:10。
    expect(status.raw).toMatchObject({ queuedSec: 30, renderSec: 460, timings: null })
  })

  it('記録にプロンプトも画像も合言葉も入れない', async () => {
    const { status } = await succeed()
    if (status.state !== 'succeeded') throw new Error('succeeded ではない')
    const text = JSON.stringify(status.raw)
    expect(text).not.toContain('takepi')
    expect(text).not.toContain(WAN_TOKEN)
  })

  it('出力が mp4 でなければ取り込まない', async () => {
    const { fetch } = createFetch((url) =>
      url === WAN_OUTPUT_URL
        ? bytesResponse(MP4_BYTES, 'text/html')
        : jsonResponse(200, WAN_SUCCEEDED_JOB),
    )
    const error = await makeWanProvider(fetch, outputDir)
      .poll(handle())
      .catch((e: unknown) => e)
    expect((error as { code?: string }).code).toBe('wan_invalid_response')
  })
})

describe('取消', () => {
  it('サーバへ DELETE を送る', async () => {
    const { calls, fetch } = createFetch(() => jsonResponse(200, WAN_CANCELED_JOB))
    await makeWanProvider(fetch, outputDir).cancel(handle())
    expect(calls).toMatchObject([{ url: WAN_JOB_URL, method: 'DELETE' }])
  })

  it.each([409, 404])('止める対象が無い（%i）のは失敗ではない', async (status) => {
    const { fetch } = createFetch(() => jsonResponse(status, errorEnvelope('conflict', false)))
    await expect(makeWanProvider(fetch, outputDir).cancel(handle())).resolves.toBeUndefined()
  })

  it('それ以外の失敗は投げる', async () => {
    const { fetch } = createFetch(() => jsonResponse(500, errorEnvelope('internal', true)))
    await expect(makeWanProvider(fetch, outputDir).cancel(handle())).rejects.toBeInstanceOf(
      ProviderError,
    )
  })
})

/**
 * 失敗の種類を見分けられること（ADR-0040 の指示「最低限区別する」）。
 * **サーバの `code` に `wan_` を付けて運ぶ**ので、記録を見ればどちらのサーバで何が起きたか分かる。
 */
describe('失敗の種類', () => {
  const codeOf = async (status: number, body: unknown): Promise<string> => {
    const { fetch } = createFetch(() => jsonResponse(status, body))
    const error = await makeWanProvider(fetch, outputDir)
      .poll(handle())
      .catch((e: unknown) => e)
    return (error as { code?: string }).code ?? 'なし'
  }

  it.each([
    [401, 'unauthorized', 'wan_unauthorized'],
    [403, 'forbidden_host', 'wan_forbidden_host'],
    [404, 'not_found', 'wan_not_found'],
    [409, 'conflict', 'wan_conflict'],
    [413, 'payload_too_large', 'wan_payload_too_large'],
    [422, 'invalid_params', 'wan_invalid_params'],
    [500, 'internal', 'wan_internal'],
  ])('HTTP %i（%s）は %s として記録する', async (status, serverCode, expected) => {
    expect(await codeOf(status, errorEnvelope(serverCode, status >= 500))).toBe(expected)
  })

  it('封筒が読めなくても HTTP の状態から種類を決める', async () => {
    expect(await codeOf(401, 'Unauthorized')).toBe('wan_unauthorized')
    expect(await codeOf(503, undefined)).toBe('wan_internal')
  })

  /** 届いていない（サーバが止まっている）と、届いたかもしれない（切れた）を分ける。 */
  it('つながらないのと、応答が返らないのを分ける', async () => {
    const refused = createFetch(() => connectionRefused())
    const unreachable = await makeWanProvider(refused.fetch, outputDir)
      .poll(handle())
      .catch((e: unknown) => e)
    expect((unreachable as { code?: string }).code).toBe('wan_unreachable')

    const reset = createFetch(() => connectionReset())
    const noResponse = await makeWanProvider(reset.fetch, outputDir)
      .poll(handle())
      .catch((e: unknown) => e)
    expect((noResponse as { code?: string }).code).toBe('wan_no_response')
    // どちらもやり直せる（サーバの再起動中に走っている生成を捨てない）。
    expect((unreachable as ProviderError).retryable).toBe(true)
    expect((noResponse as ProviderError).retryable).toBe(true)
  })

  it('画面に出る文に URL も合言葉も入らない', async () => {
    const { fetch } = createFetch(() =>
      jsonResponse(500, errorEnvelope('internal', true, 'failed http://127.0.0.1:8766/x?sig=1')),
    )
    const error = await makeWanProvider(fetch, outputDir, WAN_TOKEN)
      .poll(handle())
      .catch((e: unknown) => e)
    expect(wanLeaksSecret((error as Error).message)).toBe(false)
  })
})

describe('同じ機械の GPU を使うことを宣言する（ADR-0040）', () => {
  it('local-gpu を名乗る（worker がこれを見て 1 本ずつにする）', () => {
    const { fetch } = createFetch(() => jsonResponse(200, WAN_QUEUED_JOB))
    expect(makeWanProvider(fetch, outputDir).exclusiveResource).toBe('local-gpu')
  })

  it('未知のモデルは扱わない（vpipe のモデルを渡しても動かない）', async () => {
    const { fetch } = createFetch(() => jsonResponse(200, WAN_QUEUED_JOB))
    await expect(
      makeWanProvider(fetch, outputDir).poll(handle('vpipe/minimax-h3-turbo' as never)),
    ).rejects.toBeInstanceOf(ProviderError)
  })
})
