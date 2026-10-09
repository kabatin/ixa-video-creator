import { canProduceDuration, quantizeDuration } from '@ixa/domain'
import type { MediaAssetId, ReferenceRole } from '@ixa/domain'
import { ProviderError, VideoModelCapabilities } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { STUB_PROVIDER_IDS } from '../stub/descriptor.js'
import {
  framesForDuration,
  isNativeFrameCount,
  VPIPE_DURATIONS_SEC,
  VPIPE_IDENTITY,
  VPIPE_MODEL_QUALITIES,
  VPIPE_NATIVE_FRAME_COUNTS,
  VPIPE_POLL_POLICY,
  VPIPE_PROVIDER_ID,
  vpipeH3TurboDraftModel,
  vpipeH3TurboModel,
  vpipeVideoModels,
} from '../vpipe/descriptor.js'
import { createVpipeVideoProvider } from '../vpipe/provider.js'
import { localServerErrorFor, reasonOf, retryAfterMsFrom } from '../local-server/http.js'
import {
  decodeLocalServerJobRef,
  encodeLocalServerJobRef,
} from '../local-server/job-ref.js'
import {
  imageMediaTypeOf,
  LOCAL_SERVER_MAX_PROMPT_CHARS,
  selectStartReference,
} from '../local-server/request.js'
import { buildVpipeBody, VPIPE_STEPS } from '../vpipe/request.js'
import { makeSpec } from './fixtures.js'
import { errorEnvelope, JOB_ID } from './vpipe-fixtures.js'

const reference = (n: number, role: ReferenceRole) => ({
  mediaAssetId: `asset-${String(n)}` as MediaAssetId,
  role,
  weight: 1,
})

describe('尺とコマ数（H3 は 17n+5 コマ・24fps だけ）', () => {
  /** 定数どうしで突き合わせると宣言のずれを見逃すので、実数で留める。 */
  it('宣言する尺は 2.333〜10.125 秒の 12 通り', () => {
    expect(VPIPE_DURATIONS_SEC).toEqual([
      2.333, 3.042, 3.75, 4.458, 5.167, 5.875, 6.583, 7.292, 8, 8.708, 9.417, 10.125,
    ])
    expect(VPIPE_NATIVE_FRAME_COUNTS).toEqual([
      56, 73, 90, 107, 124, 141, 158, 175, 192, 209, 226, 243,
    ])
  })

  it('宣言したどの尺もコマ数へ戻せて、17n+5 に載る', () => {
    for (const [index, durationSec] of VPIPE_DURATIONS_SEC.entries()) {
      const frames = framesForDuration(durationSec)
      expect(frames).toBe(VPIPE_NATIVE_FRAME_COUNTS[index])
      expect((frames - 5) % 17).toBe(0)
      expect(isNativeFrameCount(frames)).toBe(true)
      // 生成尺と実測尺（frames / 24）の差は technical レビューの許容（±0.05 秒）に十分収まる。
      expect(Math.abs(frames / 24 - durationSec)).toBeLessThan(0.001)
    }
  })

  it('17n+5 に載らない尺は丸めずに投げる', () => {
    expect(() => framesForDuration(4)).toThrow(ProviderError)
    expect(() => framesForDuration(11)).toThrow(ProviderError)
    expect(() => framesForDuration(2)).toThrow(ProviderError)
  })

  it('範囲外のコマ数は受けない（n = 3..14）', () => {
    expect(isNativeFrameCount(39)).toBe(false)
    expect(isNativeFrameCount(260)).toBe(false)
    expect(isNativeFrameCount(100)).toBe(false)
  })

  it('編集尺は素の長さへ切り上がる（切り詰めは起きない）', () => {
    const { durations } = vpipeH3TurboModel.capabilities
    expect(quantizeDuration(4, durations)).toBe(4.458)
    expect(quantizeDuration(3.75, durations)).toBe(3.75)
    expect(quantizeDuration(1, durations)).toBe(2.333)
    expect(canProduceDuration(10.125, durations)).toBe(true)
    // 最長を超えたら最長で作り、ゆっくり再生して埋める（1.5 倍まで。ADR-0011 追記）
    expect(quantizeDuration(10.13, durations)).toBe(10.125)
    expect(canProduceDuration(15.1875, durations)).toBe(true)
    expect(canProduceDuration(15.19, durations)).toBe(false)
  })
})

describe('capability 宣言', () => {
  it('VideoModelCapabilities スキーマを満たす', () => {
    for (const model of vpipeVideoModels) {
      expect(() => VideoModelCapabilities.parse(model.capabilities)).not.toThrow()
      expect(model.providerId).toBe(VPIPE_PROVIDER_ID)
    }
  })

  /** 遅く 1 本ずつで、費用 0 がスコアを支配する。AUTO に選ばせない。 */
  it('どちらも AUTO の候補にしない', () => {
    for (const model of vpipeVideoModels) expect(model.routable).toBe(false)
  })

  it('費用は 0 だがスタブ扱いにしない', () => {
    for (const model of vpipeVideoModels) expect(model.economics.costPerSecondUsd).toBe(0)
    expect(STUB_PROVIDER_IDS).not.toContain(VPIPE_PROVIDER_ID)
  })

  it('所要時間の見込みは実測（draft 7 分 / standard 10.6 分）', () => {
    expect(vpipeH3TurboDraftModel.economics.typicalLatencySec).toBe(420)
    expect(vpipeH3TurboModel.economics.typicalLatencySec).toBe(640)
  })

  it('モデルごとに生成の段が決まる', () => {
    expect(VPIPE_MODEL_QUALITIES[vpipeH3TurboDraftModel.id]).toBe('draft')
    expect(VPIPE_MODEL_QUALITIES[vpipeH3TurboModel.id]).toBe('standard')
  })

  it('解像度はサーバが拡大して合わせる 8 通り', () => {
    expect(vpipeH3TurboModel.capabilities.resolutions).toEqual([
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 1080, height: 1920 },
      { width: 720, height: 1280 },
      { width: 1080, height: 1080 },
      { width: 720, height: 720 },
      { width: 1080, height: 1350 },
      { width: 864, height: 1080 },
    ])
    expect(vpipeH3TurboModel.capabilities.aspectRatios).toEqual(['16:9', '9:16', '1:1', '4:5'])
    expect(vpipeH3TurboModel.capabilities.fps).toEqual([24])
  })

  it('参照は開始画像の 2 つの role だけ。end_frame はまだ宣言しない', () => {
    const { referenceImages } = vpipeH3TurboModel.capabilities
    expect(referenceImages).toEqual({ max: 2, roles: ['start_frame', 'previous_shot_last_frame'] })
    expect(referenceImages.roles).not.toContain('end_frame')
  })

  it('negative prompt と音は宣言しない。最初のフレームは必須にしない', () => {
    const caps = vpipeH3TurboModel.capabilities
    expect(caps.negativePrompt).toBe(false)
    expect(caps.audioGeneration).toBe(false)
    expect(caps.seed).toBe(true)
    expect(caps.requiresStartFrame).toBeUndefined()
  })
})

/** 手元のサーバなので 30 秒おきに問い合わせる（ADR-0031。既定の最大 2 分おきでは 9〜99 秒遅れた）。 */
describe('問い合わせの方針', () => {
  it('30 秒おき・360 回。Provider がそれを持つ', () => {
    expect(VPIPE_POLL_POLICY).toEqual({ maxIntervalMs: 30_000, maxAttempts: 360 })
    const provider = createVpipeVideoProvider({ outputDir: '/tmp/ixa-vpipe-unused' })
    expect(provider.pollPolicy).toEqual(VPIPE_POLL_POLICY)
  })

  it('360 回で待てる時間が、前の 1 本と自分（各 25 分）を十分に覆う（約 3 時間）', () => {
    // worker の伸ばし方（5 秒から倍々、上限で頭打ち）と同じ計算。
    const budgetMs = Array.from({ length: VPIPE_POLL_POLICY.maxAttempts }, (_unused, i) =>
      Math.min(5_000 * 2 ** i, VPIPE_POLL_POLICY.maxIntervalMs),
    ).reduce((sum, ms) => sum + ms, 0)
    const worstCaseMs = 2 * 25 * 60 * 1000
    expect(budgetMs).toBeGreaterThan(3 * worstCaseMs)
    expect(budgetMs / 3_600_000).toBeCloseTo(2.98, 1)
  })
})

describe('開始画像の選び方', () => {
  it('start_frame を previous_shot_last_frame より優先し、残りを記録用に返す', () => {
    const start = reference(1, 'start_frame')
    const previous = reference(2, 'previous_shot_last_frame')
    const selection = selectStartReference([previous, start])
    expect(selection.chosen).toBe(start)
    expect(selection.ignored).toEqual([previous])
  })

  it('start_frame が無ければ previous_shot_last_frame を使う', () => {
    const previous = reference(2, 'previous_shot_last_frame')
    expect(selectStartReference([previous])).toEqual({ chosen: previous, ignored: [] })
  })

  it('同じ role が 2 つなら並びの先頭を使い、2 つ目は捨てたと記録する', () => {
    const first = reference(1, 'start_frame')
    const second = reference(2, 'start_frame')
    expect(selectStartReference([first, second])).toEqual({ chosen: first, ignored: [second] })
  })

  it('参照が無ければ文章だけから作る', () => {
    expect(selectStartReference([])).toEqual({ chosen: null, ignored: [] })
  })
})

describe('画像の形式', () => {
  it('PNG / JPEG / WebP だけを受ける。パラメータと大文字は無視する', () => {
    expect(imageMediaTypeOf('image/png')).toBe('image/png')
    expect(imageMediaTypeOf('IMAGE/PNG; charset=binary')).toBe('image/png')
    expect(imageMediaTypeOf('image/jpeg')).toBe('image/jpeg')
    expect(imageMediaTypeOf('image/jpg')).toBe('image/jpeg')
    expect(imageMediaTypeOf('image/webp')).toBe('image/webp')
    expect(imageMediaTypeOf('image/gif')).toBeNull()
    expect(imageMediaTypeOf('application/octet-stream')).toBeNull()
    expect(imageMediaTypeOf(null)).toBeNull()
  })
})

describe('本文の組み立て: 開始画像の有無と文面（h3-official-v2）', () => {
  const spec = () => makeSpec({ resolution: { width: 1920, height: 1080 } })
  const IMAGE = { data: 'AAAA', media_type: 'image/png' as const }

  it('画像を後から足す投入でも、足すと伝えれば 1 行目が入る', () => {
    const body = buildVpipeBody({ spec: spec(), quality: 'draft', frames: 56, startImage: null, hasStartImage: true })
    expect(body.prompt.startsWith('For the target video, at 0.00 seconds')).toBe(true)
    expect(body.start_image).toBeNull()
  })

  it('画像を渡しながら「画像なし」で組もうとしたら投げる（v1 の取り違えを黙って通さない）', () => {
    expect(() =>
      buildVpipeBody({ spec: spec(), quality: 'draft', frames: 56, startImage: IMAGE, hasStartImage: false }),
    ).toThrow(/画像なし/)
  })
})

describe('本文の組み立て', () => {
  const build = (overrides: Parameters<typeof makeSpec>[0] = {}) =>
    buildVpipeBody({
      spec: makeSpec({ resolution: { width: 1920, height: 1080 }, ...overrides }),
      quality: 'standard',
      frames: 107,
      startImage: null,
      hasStartImage: false,
    })

  it('契約どおりの形になる（出力は Project の解像度そのもの・最後のフレームは常に null）', () => {
    expect(build({ seed: 42 })).toEqual({
      // 公式の書き方へ組み直してから送る（ADR-0042）。文面は `h3-prompt.test.ts` が版ごと凍結している。
      prompt: [
        'integrated_multimodal_description: [Shot 1] Framed as a medium close-up. takepi が勝利する.',
        '',
        'overall_soundscape: Natural ambience that matches the scene.',
        '',
        'non_diegetic_music: None.',
      ].join('\n'),
      output: { width: 1920, height: 1080 },
      frames: 107,
      quality: 'standard',
      seed: 42,
      steps: VPIPE_STEPS,
      start_image: null,
      end_image: null,
    })
  })

  it('ステップ数はサーバの既定に任せず 6 を明示する', () => {
    expect(VPIPE_STEPS).toBe(6)
    expect(build().steps).toBe(6)
  })

  it('seed が無ければ null で送る（サーバが選び、seed_used で返す）', () => {
    expect(build({ seed: null }).seed).toBeNull()
  })

  it('空のプロンプト・長すぎるプロンプト・負の seed は投げる前に弾く', () => {
    expect(() => build({ prompt: '  ' })).toThrow(ProviderError)
    expect(() => build({ prompt: 'あ'.repeat(LOCAL_SERVER_MAX_PROMPT_CHARS + 1) })).toThrow(/上限/)
    expect(() => build({ prompt: 'あ'.repeat(LOCAL_SERVER_MAX_PROMPT_CHARS) })).not.toThrow()
    expect(() => build({ seed: -1 })).toThrow(ProviderError)
  })

  /**
   * 公式の書き方へ組み直すと文面は長くなる（ADR-0042）。
   * **仕様の文面が上限の中でも、送るものが超えることがある。** 送る側でもう一度見ていないと、
   * ここは素通りしてサーバの 422 で初めて分かる。
   */
  it('組み直した結果が上限を超えたら、投げる前に弾く', () => {
    const longDescription = 'あ'.repeat(LOCAL_SERVER_MAX_PROMPT_CHARS - 100)
    const spec = makeSpec()

    expect(() =>
      build({ prompt: '短い', promptParts: { ...spec.promptParts, shotDescription: longDescription } }),
    ).toThrow(/上限/)
  })
})

describe('ジョブ参照', () => {
  it('サーバのジョブ ID をそのまま使う', () => {
    expect(encodeLocalServerJobRef(VPIPE_IDENTITY, JOB_ID)).toBe(JOB_ID)
    expect(decodeLocalServerJobRef(VPIPE_IDENTITY, JOB_ID)).toBe(JOB_ID)
  })

  it('パスや URL を壊す形は読まずに落とす（やり直せない失敗）', () => {
    for (const garbage of ['', '../etc/passwd', 'job 1', 'job/1', 'a'.repeat(129)]) {
      const error = ((): unknown => {
        try {
          decodeLocalServerJobRef(VPIPE_IDENTITY, garbage)
          return null
        } catch (e) {
          return e
        }
      })()
      expect(error).toBeInstanceOf(ProviderError)
      expect((error as ProviderError).retryable).toBe(false)
    }
    expect(() => encodeLocalServerJobRef(VPIPE_IDENTITY, '../x')).toThrow(ProviderError)
  })
})

describe('HTTP の失敗と待ち時間', () => {
  it('封筒の code と retryable をそのまま使う', () => {
    const error = localServerErrorFor(VPIPE_IDENTITY, 
      422,
      errorEnvelope('invalid_params', false, 'frames must be 17n+5'),
      '投入',
    )
    expect(error.code).toBe('vpipe_invalid_params')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('frames must be 17n+5')
    expect(error.status).toBe(422)
  })

  it('封筒が読めなければ HTTP の状態で判断する', () => {
    expect(localServerErrorFor(VPIPE_IDENTITY, 503, undefined, '投入')).toMatchObject({
      code: 'vpipe_internal',
      retryable: true,
    })
    expect(localServerErrorFor(VPIPE_IDENTITY, 401, 'Unauthorized', '投入')).toMatchObject({
      code: 'vpipe_unauthorized',
      retryable: false,
    })
    expect(localServerErrorFor(VPIPE_IDENTITY, 429, {}, '投入')).toMatchObject({ code: 'vpipe_busy', retryable: true })
  })

  it('理由に URL が混ざっていても外へ出さない', () => {
    const error = localServerErrorFor(VPIPE_IDENTITY, 
      500,
      errorEnvelope('internal', true, 'failed http://10.0.0.1/x?sig=1'),
      '投入',
    )
    expect(error.message).not.toContain('10.0.0.1')
    expect(error.message).not.toContain('sig=1')
  })

  /** 手元のサーバの例外文には置き場所（利用者の名前を含む）が混ざりやすい。画面に出さない。 */
  it('理由から絶対パスを落とす（比や割合の / は残す）', () => {
    const message = [
      "No such file: '/Users/hiroshi/vpipe/models/h3.safetensors'",
      'cache at /home/kaba/.cache/vpipe/x and /private/var/folders/ab/T/y.png',
      'aspect 16:9 … 9:16, and/or 1/2 speed',
    ].join('; ')
    const reason = reasonOf(message)
    expect(reason).not.toContain('hiroshi')
    expect(reason).not.toContain('/home/kaba')
    expect(reason).not.toContain('/private/var')
    expect(reason).toContain('[path]')
    expect(reason).toContain('16:9 … 9:16, and/or 1/2 speed')
  })

  it('理由が空なら「理由不明」、長すぎれば切る', () => {
    expect(reasonOf('   ')).toBe('理由不明')
    expect(reasonOf('あ'.repeat(400)).length).toBeLessThanOrEqual(301)
  })

  it('Retry-After は秒と HTTP 日付の両方を読む。読めなければ null', () => {
    const now = Date.parse('2026-09-30T12:00:00Z')
    expect(retryAfterMsFrom(new Headers({ 'retry-after': '30' }), now)).toBe(30_000)
    expect(
      retryAfterMsFrom(new Headers({ 'retry-after': 'Wed, 30 Sep 2026 12:01:00 GMT' }), now),
    ).toBe(60_000)
    expect(retryAfterMsFrom(new Headers({ 'retry-after': 'soon' }), now)).toBeNull()
    expect(retryAfterMsFrom(new Headers(), now)).toBeNull()
  })
})
