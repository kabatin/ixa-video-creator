import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAssetId, ShotGenerationSpec } from '@ixa/domain'
import {
  CapabilityViolationError,
  ProviderBusyError,
  ProviderError,
  type VideoModelDescriptor,
} from '@ixa/provider-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vpipeH3TurboDraftModel, vpipeH3TurboModel } from '../vpipe/descriptor.js'
import { createVpipeVideoProvider } from '../vpipe/provider.js'
import { createTempDir, makeSpec, removeTempDir } from './fixtures.js'
import {
  bytesResponse,
  connectionRefused,
  createFetch,
  errorEnvelope,
  HEALTH_URL,
  JOB_ID,
  jsonResponse,
  makeVpipeProvider,
  PNG_BYTES,
  serverRoutes,
  SIGNED_URL_PREFIX,
  submitCallOf,
  SUBMIT_BODY,
  SUBMIT_URL,
  TOKEN,
  vpipeRequestFor,
  type Call,
  type Handler,
} from './vpipe-fixtures.js'

let outputDir = ''
beforeEach(async () => {
  outputDir = await createTempDir()
})
afterEach(async () => {
  await removeTempDir(outputDir)
})

/** Project の既定（1080p・24fps）に合わせた仕様。尺 4 秒は 4.458 秒（107 コマ）へ切り上がる。 */
const spec = (overrides: Partial<ShotGenerationSpec> = {}): ShotGenerationSpec =>
  makeSpec({ resolution: { width: 1920, height: 1080 }, fps: 24, ...overrides })

/** 投入にこの応答を返すサーバ（空きの確認は空き、開始画像は PNG）。 */
const answer = (status: number, body: unknown, headers: Record<string, string> = {}): Handler =>
  serverRoutes({ submit: () => jsonResponse(status, body, headers) })

const ACCEPTING = answer(202, SUBMIT_BODY)

const submitWith = async (handler: Handler, request = vpipeRequestFor(spec()), token?: string) => {
  const { calls, fetch } = createFetch(handler)
  const provider = makeVpipeProvider(fetch, outputDir, token)
  const result = await provider.submit(request).catch((error: unknown) => error)
  return { calls, result }
}

const posted = (calls: readonly Call[]) =>
  JSON.parse(submitCallOf(calls)?.body ?? '{}') as Record<string, unknown>

describe('submit', () => {
  it('ワークフローへ投入し、ジョブ ID をハンドルに持つ', async () => {
    const { calls, result } = await submitWith(ACCEPTING)

    // 空きを確かめてから投入する（開始画像が無いので画像の取り寄せは無い）。
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${HEALTH_URL}`,
      `POST ${SUBMIT_URL}`,
    ])
    expect(result).toMatchObject({
      providerId: 'vpipe',
      modelId: vpipeH3TurboModel.id,
      ref: JOB_ID,
    })
  })

  it('本文は契約どおり（尺はコマ数へ・出力は Project の解像度・段はモデルから）', async () => {
    const { calls } = await submitWith(ACCEPTING, vpipeRequestFor(spec({ seed: 7 })))
    expect(posted(calls)).toEqual({
      prompt: 'takepi が勝利する',
      output: { width: 1920, height: 1080 },
      frames: 107,
      quality: 'standard',
      seed: 7,
      steps: 6,
      start_image: null,
      end_image: null,
    })
  })

  it('下書きのモデルは draft で投げる', async () => {
    const { calls } = await submitWith(ACCEPTING, vpipeRequestFor(spec(), vpipeH3TurboDraftModel))
    expect(posted(calls).quality).toBe('draft')
  })

  it('トークンは Bearer ヘッダでだけ送る（本文にもクエリにも載せない）', async () => {
    const { calls } = await submitWith(ACCEPTING, vpipeRequestFor(spec()), TOKEN)
    for (const call of calls) expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(submitCallOf(calls)?.url).not.toContain(TOKEN)
    expect(submitCallOf(calls)?.body).not.toContain(TOKEN)
  })

  it('トークンが無ければ Authorization を付けない', async () => {
    const { calls } = await submitWith(ACCEPTING)
    for (const call of calls) expect(call.headers.Authorization).toBeUndefined()
  })

  it('最初のフレームは署名付き URL から取り寄せ、base64 と形式で送る', async () => {
    const request = vpipeRequestFor(
      spec({
        references: [{ mediaAssetId: 'asset-1' as MediaAssetId, role: 'start_frame', weight: 1 }],
      }),
    )
    const { calls } = await submitWith(
      serverRoutes({
        submit: () => jsonResponse(202, SUBMIT_BODY),
        image: () => bytesResponse(PNG_BYTES, 'image/png; charset=binary'),
      }),
      request,
      TOKEN,
    )

    const imageCall = calls.find((c) => c.url.startsWith(SIGNED_URL_PREFIX))
    expect(imageCall?.url).toContain('asset-1')
    // ストレージへはトークンを渡さない。
    expect(imageCall?.headers.Authorization).toBeUndefined()
    expect(posted(calls).start_image).toEqual({
      data: Buffer.from(PNG_BYTES).toString('base64'),
      media_type: 'image/png',
    })
    // 署名付き URL はサーバへ送らない（中身だけ送る）。
    expect(submitCallOf(calls)?.body).not.toContain('X-Amz-Signature')
  })

  it('start_frame が無ければ前の Shot の最後のフレームを開始画像にする', async () => {
    const request = vpipeRequestFor(
      spec({
        references: [
          {
            mediaAssetId: 'asset-prev' as MediaAssetId,
            role: 'previous_shot_last_frame',
            weight: 0.8,
          },
        ],
      }),
    )
    const { calls } = await submitWith(ACCEPTING, request)
    expect(calls.find((c) => c.url.startsWith(SIGNED_URL_PREFIX))?.url).toContain('asset-prev')
    expect(posted(calls).start_image).not.toBeNull()
  })

  it('開始画像が PNG / JPEG / WebP でなければ投入しない（やり直せない失敗）', async () => {
    const request = vpipeRequestFor(
      spec({
        references: [{ mediaAssetId: 'asset-1' as MediaAssetId, role: 'start_frame', weight: 1 }],
      }),
    )
    const { calls, result } = await submitWith(
      serverRoutes({
        submit: () => jsonResponse(202, SUBMIT_BODY),
        image: () => bytesResponse(PNG_BYTES, 'image/gif'),
      }),
      request,
    )
    expect(result).toBeInstanceOf(ProviderError)
    expect((result as ProviderError).retryable).toBe(false)
    expect(submitCallOf(calls)).toBeUndefined()
  })

  it('開始画像を読めない失敗の文に署名付き URL を混ぜない', async () => {
    const request = vpipeRequestFor(
      spec({
        references: [{ mediaAssetId: 'asset-1' as MediaAssetId, role: 'start_frame', weight: 1 }],
      }),
    )
    const { result } = await submitWith(
      serverRoutes({
        submit: () => jsonResponse(202, SUBMIT_BODY),
        image: () => jsonResponse(503, {}),
      }),
      request,
    )
    expect(result).toBeInstanceOf(ProviderError)
    expect((result as ProviderError).retryable).toBe(true)
    expect((result as Error).message).not.toContain('X-Amz')
  })

  it('満杯（429）は ProviderBusyError。Retry-After をミリ秒で運ぶ', async () => {
    const { result } = await submitWith(
      answer(429, errorEnvelope('busy', true), { 'retry-after': '45' }),
    )
    expect(result).toBeInstanceOf(ProviderBusyError)
    expect((result as ProviderBusyError).retryAfterMs).toBe(45_000)
    expect((result as ProviderBusyError).retryable).toBe(true)
  })

  it('Retry-After が無い 429 も ProviderBusyError（待ち時間は null）', async () => {
    const { result } = await submitWith(answer(429, errorEnvelope('busy', true)))
    expect(result).toBeInstanceOf(ProviderBusyError)
    expect((result as ProviderBusyError).retryAfterMs).toBeNull()
  })

  const failures: readonly { status: number; code: string; retryable: boolean }[] = [
    { status: 401, code: 'unauthorized', retryable: false },
    { status: 413, code: 'payload_too_large', retryable: false },
    { status: 422, code: 'invalid_params', retryable: false },
    { status: 500, code: 'internal', retryable: true },
  ]
  for (const { status, code, retryable } of failures) {
    it(`${String(status)} はサーバの retryable（${String(retryable)}）で ProviderError になる`, async () => {
      const { result } = await submitWith(answer(status, errorEnvelope(code, retryable)))
      expect(result).toBeInstanceOf(ProviderError)
      expect(result).not.toBeInstanceOf(ProviderBusyError)
      expect(result).toMatchObject({ code: `vpipe_${code}`, retryable })
    })
  }

  it('サーバが止まっていたら（接続拒否）起動を確かめるよう促す失敗にする', async () => {
    const { calls, result } = await submitWith(() => connectionRefused())
    expect(result).toMatchObject({ code: 'vpipe_unreachable', retryable: true })
    expect(result).not.toBeInstanceOf(ProviderBusyError)
    expect((result as Error).message).toContain('vpipe-api')
    // 空きの確認で分かるので、画像も投入も試さない。
    expect(calls.map((c) => c.url)).toEqual([HEALTH_URL])
  })

  it('202 の形が違えば握り潰さず失敗する', async () => {
    const { result } = await submitWith(answer(202, { status: 'queued' }))
    expect(result).toMatchObject({ code: 'vpipe_invalid_response', retryable: false })
  })

  it('ファイル名を壊すジョブ ID は受け取らない', async () => {
    const { result } = await submitWith(answer(202, { ...SUBMIT_BODY, id: '../../x' }))
    expect(result).toBeInstanceOf(ProviderError)
  })
})

describe('submit — 能力の外の要求は投入前に弾く（HTTP を 1 回も叩かない）', () => {
  const cases: readonly { name: string; overrides: Partial<ShotGenerationSpec> }[] = [
    { name: '21:9', overrides: { aspectRatio: '21:9', resolution: { width: 2560, height: 1080 } } },
    { name: '30fps', overrides: { fps: 30 } },
    { name: '4K', overrides: { resolution: { width: 3840, height: 2160 } } },
    // 最長 10.125 秒の 1.5 倍（15.1875 秒）を超える（ADR-0011 追記。1.5 倍までは最長で作って伸ばす）
    { name: '15.2 秒', overrides: { durationSec: 15.2 } },
    { name: 'negative prompt', overrides: { negativePrompt: 'blurry' } },
    {
      name: '最後のフレーム',
      overrides: {
        references: [{ mediaAssetId: 'a' as MediaAssetId, role: 'end_frame', weight: 1 }],
      },
    },
  ]
  for (const { name, overrides } of cases) {
    it(name, async () => {
      const { calls, result } = await submitWith(ACCEPTING, vpipeRequestFor(spec(overrides)))
      expect(result).toBeInstanceOf(CapabilityViolationError)
      expect(calls).toHaveLength(0)
    })
  }

  it('知らないモデルは扱わない', async () => {
    const other: VideoModelDescriptor = {
      ...vpipeH3TurboModel,
      id: 'vpipe/unknown' as VideoModelDescriptor['id'],
    }
    const { calls, result } = await submitWith(ACCEPTING, vpipeRequestFor(spec(), other))
    expect(result).toBeInstanceOf(ProviderError)
    expect(calls).toHaveLength(0)
  })
})

describe('submit — 古い出力の掃除', () => {
  const DAY_MS = 24 * 60 * 60 * 1000

  const touch = async (path: string, ageMs: number): Promise<void> => {
    await writeFile(path, 'x')
    const at = new Date(Date.now() - ageMs)
    await utimes(path, at, at)
  }

  it('24 時間より古い自分のファイルだけを消す', async () => {
    await mkdir(join(outputDir, '.tmp'), { recursive: true })
    await mkdir(join(outputDir, '.jobs'), { recursive: true })
    await touch(join(outputDir, 'job_OLD.mp4'), DAY_MS + 60_000)
    await touch(join(outputDir, '.tmp', 'job_OLD.abc.part'), DAY_MS + 60_000)
    await touch(join(outputDir, '.jobs', 'job_OLD.json'), DAY_MS + 60_000)
    await touch(join(outputDir, 'job_NEW.mp4'), 60_000)
    await touch(join(outputDir, 'keep.txt'), DAY_MS * 3)

    await submitWith(ACCEPTING)

    expect((await readdir(outputDir)).sort()).toEqual(['.jobs', '.tmp', 'job_NEW.mp4', 'keep.txt'])
    expect(await readdir(join(outputDir, '.tmp'))).toEqual([])
    // 残るのは今回の投入の控えだけ。
    expect(await readdir(join(outputDir, '.jobs'))).toEqual([`${JOB_ID}.json`])
  })

  it('置き場がまだ無くても投入は止めない（掃除は投げない）', async () => {
    const { fetch } = createFetch(ACCEPTING)
    const provider = createVpipeVideoProvider({
      outputDir: join(outputDir, 'missing', 'dir'),
      fetch,
    })
    await expect(provider.submit(vpipeRequestFor(spec()))).resolves.toMatchObject({ ref: JOB_ID })
  })
})

describe('設定', () => {
  const { fetch } = createFetch(ACCEPTING)

  it('出力の置き場が無ければ作らせない', () => {
    expect(() => createVpipeVideoProvider({ outputDir: '', fetch })).toThrow()
  })

  it('http(s) 以外の URL は受けない', () => {
    expect(() => createVpipeVideoProvider({ outputDir, baseUrl: 'file:///tmp/x', fetch })).toThrow()
    expect(() => createVpipeVideoProvider({ outputDir, baseUrl: 'not a url', fetch })).toThrow()
  })

  it('空のトークンは未設定として扱う（空の Bearer を送らない）', async () => {
    const { calls } = await submitWith(ACCEPTING, vpipeRequestFor(spec()), '  ')
    for (const call of calls) expect(call.headers.Authorization).toBeUndefined()
  })

  it('基底 URL の末尾の / は落とす', async () => {
    const recorded = createFetch(ACCEPTING)
    const provider = createVpipeVideoProvider({
      outputDir,
      baseUrl: 'http://127.0.0.1:8765///',
      fetch: recorded.fetch,
    })
    await provider.submit(vpipeRequestFor(spec()))
    expect(recorded.calls.map((c) => c.url)).toEqual([HEALTH_URL, SUBMIT_URL])
  })

  it('作っただけでは何も起こさない（API の登録で副作用を出さない）', async () => {
    const recorded = createFetch(ACCEPTING)
    createVpipeVideoProvider({ outputDir: join(outputDir, 'untouched'), fetch: recorded.fetch })
    expect(recorded.calls).toHaveLength(0)
    expect(await readdir(outputDir)).toEqual([])
  })
})
