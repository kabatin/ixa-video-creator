import { join } from 'node:path'
import { CapabilityViolationError, ProviderError, type ProviderJobHandle } from '@ixa/provider-core'
import { probeMedia } from '@ixa/media'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stubGeminiLikeImageModel } from '../stub/descriptor.js'
import { quadrantColorsForPrompt } from '../stub/color.js'
import { createStubImageProvider, imageSeedFor, signatureForPrompt } from '../stub/provider.js'
import { renderPlaceholderImage } from '../stub/render-image.js'
import {
  assetId,
  channelDistance,
  createTempDir,
  hexToRgb,
  localPathsOf,
  makeImageRequest,
  makeImageModel,
  pollUntilSucceeded,
  removeTempDir,
  samplePixelAt,
  sha256OfFile,
} from './fixtures.js'

const TEST_TIMEOUT_MS = 120_000

/** 象限 0 の内側で、ラベル・ティック・シルエット・枠線のどれとも重ならない位置。 */
const SAMPLE_X = 358
const SAMPLE_Y = 51

const PROMPT_A = 'takepi turnaround sheet'
const PROMPT_B = 'kaba turnaround sheet'

describe('スタブ画像 Provider（実 ffmpeg）', () => {
  let outputDir = ''

  beforeAll(async () => {
    outputDir = await createTempDir()
  })

  afterAll(async () => {
    await removeTempDir(outputDir)
  })

  it('FFMPEG_PATH を設定せず、素の ffmpeg で動く前提であること', () => {
    // drawtext を持たない Homebrew の ffmpeg 9.x でも通ることをこのテスト群全体で保証する。
    expect(process.env.FFMPEG_PATH ?? '').toBe('')
  })

  it(
    '四面図モードで、指定した解像度の画像を生成する',
    async () => {
      const provider = createStubImageProvider({ outputDir })
      const handle = await provider.submit(
        makeImageRequest(stubGeminiLikeImageModel, {
          prompt: 'takepi turnaround sheet',
          seed: 7,
        }),
      )
      const status = await pollUntilSucceeded(provider, handle)
      const [path] = localPathsOf(status)
      expect(path).toBeDefined()

      const probe = await probeMedia(path ?? '')
      expect(probe.width).toBe(1024)
      expect(probe.height).toBe(1024)
      expect(status.raw.mode).toBe('four_view')
      expect(status.seedUsed).toBe(7)
      expect(status.costUsd).toBe(0)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '正方形でない解像度も指定どおりに守る',
    async () => {
      const provider = createStubImageProvider({ outputDir })
      const handle = await provider.submit(
        makeImageRequest(stubGeminiLikeImageModel, {
          prompt: 'takepi 四面図 wide',
          resolution: { width: 1280, height: 720 },
          aspectRatio: '16:9',
          seed: 11,
        }),
      )
      const status = await pollUntilSucceeded(provider, handle)
      const probe = await probeMedia(localPathsOf(status)[0] ?? '')
      expect(probe.width).toBe(1280)
      expect(probe.height).toBe(720)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '同じプロンプト・同じ seed なら同じ画像、違うプロンプトなら違う背景色になる',
    async () => {
      const provider = createStubImageProvider({ outputDir })
      const generate = async (prompt: string): Promise<string> => {
        const handle = await provider.submit(
          makeImageRequest(stubGeminiLikeImageModel, { prompt, seed: 5 }),
        )
        const status = await pollUntilSucceeded(provider, handle)
        return localPathsOf(status)[0] ?? ''
      }

      const [first, second, other] = await Promise.all([
        generate(PROMPT_A),
        generate(PROMPT_A),
        generate(PROMPT_B),
      ])

      expect(await sha256OfFile(first)).toBe(await sha256OfFile(second))
      expect(await sha256OfFile(first)).not.toBe(await sha256OfFile(other))

      const sample = (path: string) => samplePixelAt(path, outputDir, SAMPLE_X, SAMPLE_Y)
      const [a, b, c] = await Promise.all([sample(first), sample(second), sample(other)])

      // 同じプロンプトなら 1 ビットも違わない
      expect(channelDistance(a, b)).toBe(0)
      // 画面に出ている色が、プロンプトから決まる色そのものであること（ノイズぶんだけ許容）
      const expectedA = hexToRgb(quadrantColorsForPrompt(PROMPT_A)[0] ?? '')
      const expectedB = hexToRgb(quadrantColorsForPrompt(PROMPT_B)[0] ?? '')
      expect(channelDistance(a, expectedA)).toBeLessThan(10)
      expect(channelDistance(c, expectedB)).toBeLessThan(10)
      // 違うプロンプトなら目で分かるだけ違う
      expect(channelDistance(a, c)).toBeGreaterThan(20)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'count 枚を生成し、内容が互いに異なる',
    async () => {
      const provider = createStubImageProvider({ outputDir })
      const handle = await provider.submit(
        makeImageRequest(stubGeminiLikeImageModel, {
          prompt: 'takepi の Look 候補',
          seed: 3,
          count: 3,
        }),
      )
      const status = await pollUntilSucceeded(provider, handle)
      const paths = localPathsOf(status)
      expect(paths).toHaveLength(3)
      expect(status.raw.mode).toBe('plain')

      const digests = await Promise.all(paths.map(sha256OfFile))
      expect(new Set(digests).size).toBe(3)

      for (const path of paths) {
        const probe = await probeMedia(path)
        expect(probe.width).toBe(1024)
      }
    },
    TEST_TIMEOUT_MS,
  )

  it('参照画像の枚数超過は submit の時点で弾く', async () => {
    const provider = createStubImageProvider({ outputDir })
    const request = makeImageRequest(stubGeminiLikeImageModel, {
      references: Array.from({ length: 15 }, () => ({
        mediaAssetId: assetId(),
        role: 'subject' as const,
      })),
    })
    await expect(provider.submit(request)).rejects.toBeInstanceOf(CapabilityViolationError)
  })

  it('未知のモデルは扱わない', async () => {
    const provider = createStubImageProvider({ outputDir })
    const request = makeImageRequest(makeImageModel({ id: 'gemini/3.1-flash-image' }))
    await expect(provider.submit(request)).rejects.toBeInstanceOf(ProviderError)
  })

  it('未知のハンドルは同期 throw ではなく reject で返す', async () => {
    const provider = createStubImageProvider({ outputDir })
    const handle = {
      providerId: stubGeminiLikeImageModel.providerId,
      modelId: stubGeminiLikeImageModel.id,
      ref: 'missing',
      submittedAt: new Date(),
    }
    await expect(provider.poll(handle)).rejects.toBeInstanceOf(ProviderError)
    await expect(provider.cancel(handle)).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('drawtext が無い環境への縮退（実 ffmpeg）', () => {
  let outputDir = ''

  beforeAll(async () => {
    outputDir = await createTempDir()
  })

  afterAll(async () => {
    await removeTempDir(outputDir)
  })

  const input = {
    width: 1024,
    height: 1024,
    mode: 'four_view' as const,
    backgroundColor: '#2E1A4D',
    quadrantColors: ['#2E1A4D', '#33205A', '#382766', '#3D2E72'],
    figureColor: '#C9B8E8',
    signature: '382fcbde',
    seed: 42,
  }

  it(
    '例外にならず、解像度を守った四面図を書き出す',
    async () => {
      const outputPath = join(outputDir, 'degraded.png')
      const result = await renderPlaceholderImage(
        { ...input, outputPath },
        { drawtextAvailable: false },
      )
      expect(result.mode).toBe('degraded_no_drawtext')

      const probe = await probeMedia(outputPath)
      expect(probe.width).toBe(1024)
      expect(probe.height).toBe(1024)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '判定を注入しなければ実 ffmpeg の対応状況に従う',
    async () => {
      const outputPath = join(outputDir, 'auto.png')
      const result = await renderPlaceholderImage({ ...input, outputPath })
      expect(['text', 'degraded_no_drawtext']).toContain(result.mode)

      const probe = await probeMedia(outputPath)
      expect(probe.width).toBe(1024)
    },
    TEST_TIMEOUT_MS,
  )
})

describe('seed と署名', () => {
  it('枚ごとに seed をずらす', () => {
    expect(imageSeedFor(100, 0)).toBe(100)
    expect(imageSeedFor(100, 1)).not.toBe(imageSeedFor(100, 0))
    expect(imageSeedFor(100, 2)).toBe(imageSeedFor(100, 2))
  })

  it('署名はプロンプトから決まる 8 桁', () => {
    expect(signatureForPrompt('takepi')).toMatch(/^[0-9a-f]{8}$/)
    expect(signatureForPrompt('takepi')).toBe(signatureForPrompt('takepi'))
    expect(signatureForPrompt('takepi')).not.toBe(signatureForPrompt('hinata'))
  })
})

/**
 * 記録が無いジョブを問い合わせたときの文。
 *
 * **内部の参照（UUID）を画面へ出さない**（CLAUDE.md「画面に出さない: 内部 ID」）。
 * Provider の失敗理由はそのまま画面の通知へ流れる経路にある。
 * 映像スタブで同じ漏れを直したので、こちらにも歯止めを置く。
 */
describe('内部の参照を画面へ出さない', () => {
  const unknownHandle = {
    providerId: 'stub-image' as ProviderJobHandle['providerId'],
    modelId: stubGeminiLikeImageModel.id,
    ref: '11111111-2222-3333-4444-555555555555',
    submittedAt: new Date(),
  }

  it('文面に参照も実装の言葉も出さない', async () => {
    const provider = createStubImageProvider({ outputDir: join(process.cwd(), 'never-used') })
    const caught = await provider.poll(unknownHandle).catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(ProviderError)
    const message = (caught as ProviderError).message
    expect(message).not.toContain(unknownHandle.ref)
    expect(message).not.toMatch(/ジョブ|poll|provider|uuid/i)
    expect(message).toContain('もう一度生成してください')
  })

  it('参照は cause に残す（ログでは追える）', async () => {
    const provider = createStubImageProvider({ outputDir: join(process.cwd(), 'never-used') })
    const caught = await provider.poll(unknownHandle).catch((error: unknown) => error)

    expect(String((caught as ProviderError).cause)).toContain(unknownHandle.ref)
  })
})

