import { readFile } from 'node:fs/promises'
import { probeMedia } from '@ixa/media'
import { CapabilityViolationError } from '@ixa/provider-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { colorForShot } from '../stub/color.js'
import { stubSeedanceLikeModel, stubVeoLikeModel } from '../stub/descriptor.js'
import { createStubVideoProvider } from '../stub/provider.js'
import {
  channelDistance,
  createTempDir,
  makeRequest,
  makeSpec,
  pollUntilSettled,
  pollUntilSucceeded,
  removeTempDir,
  samplePixel,
  SHOT_ID_A,
  SHOT_ID_B,
} from './fixtures.js'

/** succeeded 状態から出力パスを取り出す。スタブは常に local を返す。 */
const outputPathOf = (status: { output: { type: string; path?: string; url?: string } }): string => {
  if (status.output.type !== 'local' || status.output.path === undefined) {
    throw new Error('スタブは local 出力を返すはずです')
  }
  return status.output.path
}


const TEST_TIMEOUT_MS = 180_000
/** libx264 の量子化で背景色は数値が僅かにずれるため、許容差を持たせる。 */
const COLOR_TOLERANCE = 12

const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
})

describe('createStubVideoProvider（実 ffmpeg）', () => {
  let outputDir = ''

  beforeAll(async () => {
    outputDir = await createTempDir()
  })

  afterAll(async () => {
    await removeTempDir(outputDir)
  })

  it(
    'submit → poll を繰り返すと succeeded になり、尺・解像度・fps を正確に守る',
    async () => {
      const provider = createStubVideoProvider({ outputDir })
      const spec = makeSpec({ durationSec: 4, resolution: { width: 1280, height: 720 }, fps: 24 })
      const handle = await provider.submit(makeRequest(stubVeoLikeModel, spec))

      expect(handle.providerId).toBe(provider.id)
      expect(handle.modelId).toBe(stubVeoLikeModel.id)

      const status = await pollUntilSucceeded(provider, handle)
      expect(status.output.type).toBe('local')
      expect(outputPathOf(status).startsWith('/')).toBe(true)
      expect(status.costUsd).toBe(0)
      // seed 未指定でもジョブ固有の値が使われる。実 Provider と同じく毎回違う絵になるため。
      expect(status.seedUsed).not.toBeNull()

      const probe = await probeMedia(outputPathOf(status))
      expect(probe.durationSec).toBeCloseTo(4, 2)
      expect(probe.width).toBe(1280)
      expect(probe.height).toBe(720)
      expect(probe.fps).toBe(24)
      expect(probe.codec).toBe('h264')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '編集尺 3.75 秒を veo-like に投げると 4 秒に切り上がる（ADR-0011）',
    async () => {
      const provider = createStubVideoProvider({ outputDir })
      const spec = makeSpec({ durationSec: 3.75, fps: 24 })
      const handle = await provider.submit(makeRequest(stubVeoLikeModel, spec))
      const status = await pollUntilSucceeded(provider, handle)

      expect(status.raw.requestedDurationSec).toBe(3.75)
      expect(status.raw.generationDurationSec).toBe(4)

      const probe = await probeMedia(outputPathOf(status))
      expect(probe.durationSec).toBeCloseTo(4, 2)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'range モデルは対応範囲内の端数尺をそのまま生成する（7.5 秒）',
    async () => {
      const provider = createStubVideoProvider({ outputDir })
      const spec = makeSpec({ durationSec: 7.5, fps: 24 })
      const handle = await provider.submit(makeRequest(stubSeedanceLikeModel, spec))
      const status = await pollUntilSucceeded(provider, handle)

      expect(status.raw.generationDurationSec).toBe(7.5)

      const probe = await probeMedia(outputPathOf(status))
      expect(probe.durationSec).toBeCloseTo(7.5, 2)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '編集尺 3.75 秒は seedance-like でも下限の 4 秒へ切り上がる',
    async () => {
      // seedance-like の durations は { mode: 'range', min: 4, max: 15 }。
      // quantizeDuration は下限未満の要求を min へ引き上げるため 3.75 は 4 になる（ADR-0011）。
      const provider = createStubVideoProvider({ outputDir })
      const spec = makeSpec({ durationSec: 3.75, fps: 24 })
      const handle = await provider.submit(makeRequest(stubSeedanceLikeModel, spec))
      const status = await pollUntilSucceeded(provider, handle)

      expect(status.raw.generationDurationSec).toBe(4)

      const probe = await probeMedia(outputPathOf(status))
      expect(probe.durationSec).toBeCloseTo(4, 2)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '同じ shotId の 2 回の生成は背景色が同じで、違う shotId とは色が変わる',
    async () => {
      const provider = createStubVideoProvider({ outputDir })
      const base = makeSpec({ durationSec: 4, fps: 24, seed: null })

      const first = await pollUntilSucceeded(
        provider,
        await provider.submit(makeRequest(stubVeoLikeModel, base)),
      )
      const second = await pollUntilSucceeded(
        provider,
        await provider.submit(
          makeRequest(stubVeoLikeModel, { ...base, prompt: '別のプロンプト' }),
        ),
      )
      const other = await pollUntilSucceeded(
        provider,
        await provider.submit(makeRequest(stubVeoLikeModel, { ...base, shotId: SHOT_ID_B })),
      )

      const firstPixel = await samplePixel(outputPathOf(first), outputDir)
      const secondPixel = await samplePixel(outputPathOf(second), outputDir)
      const otherPixel = await samplePixel(outputPathOf(other), outputDir)

      expect(channelDistance(firstPixel, secondPixel)).toBeLessThanOrEqual(COLOR_TOLERANCE)
      expect(channelDistance(firstPixel, hexToRgb(colorForShot(SHOT_ID_A)))).toBeLessThanOrEqual(
        COLOR_TOLERANCE,
      )
      expect(channelDistance(firstPixel, otherPixel)).toBeGreaterThan(COLOR_TOLERANCE)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'seed を指定するとノイズが乗り、seed 違いで絵が変わる',
    async () => {
      const provider = createStubVideoProvider({ outputDir })
      const base = makeSpec({ durationSec: 4, fps: 24 })

      const seeded = await pollUntilSucceeded(
        provider,
        await provider.submit(makeRequest(stubVeoLikeModel, { ...base, seed: 1234 })),
      )
      expect(seeded.seedUsed).toBe(1234)

      const probe = await probeMedia(outputPathOf(seeded))
      expect(probe.durationSec).toBeCloseTo(4, 2)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'エスケープが必要な記号や日本語を含む説明でも生成できる',
    async () => {
      const provider = createStubVideoProvider({ outputDir })
      const nasty = String.raw`100% : 'quote' \back\ , ; [bracket] たけぴ`
      const spec = makeSpec({
        durationSec: 4,
        fps: 24,
        prompt: nasty,
        promptParts: { ...makeSpec().promptParts, shotDescription: nasty },
      })

      const status = await pollUntilSucceeded(
        provider,
        await provider.submit(makeRequest(stubVeoLikeModel, spec)),
      )
      const probe = await probeMedia(outputPathOf(status))
      expect(probe.durationSec).toBeCloseTo(4, 2)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'cancel したジョブは succeeded にならない',
    async () => {
      const provider = createStubVideoProvider({ outputDir, simulatedLatencyMs: 200 })
      const handle = await provider.submit(
        makeRequest(stubVeoLikeModel, makeSpec({ durationSec: 8, fps: 24 })),
      )

      await provider.cancel(handle)

      const status = await pollUntilSettled(provider, handle, 10_000)
      expect(status.state).toBe('failed')
      if (status.state === 'failed') expect(status.error.code).toBe('cancelled')

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500)
      })
      expect((await provider.poll(handle)).state).toBe('failed')
    },
    TEST_TIMEOUT_MS,
  )

  it('capability を満たさない要求は submit で失敗する', async () => {
    const provider = createStubVideoProvider({ outputDir })
    const spec = makeSpec({ durationSec: 99 })

    await expect(provider.submit(makeRequest(stubVeoLikeModel, spec))).rejects.toBeInstanceOf(
      CapabilityViolationError,
    )
  })

  it('未知のジョブを poll すると失敗する', async () => {
    const provider = createStubVideoProvider({ outputDir })
    const handle = {
      providerId: provider.id,
      modelId: stubVeoLikeModel.id,
      ref: 'does-not-exist',
      submittedAt: new Date(),
    }

    await expect(provider.poll(handle)).rejects.toThrow('未知のジョブ')
  })
})

describe('seed 未指定時の挙動（実 ffmpeg）', () => {
  let outputDir = ''

  beforeEach(async () => {
    outputDir = await createTempDir()
  })

  afterEach(async () => {
    await removeTempDir(outputDir)
  })

  it('同じ仕様で 2 回生成しても内容が異なる（Take を比較できるようにするため）', async () => {
    const provider = createStubVideoProvider({ outputDir })
    const request = makeRequest(stubVeoLikeModel, makeSpec({ seed: null }))

    const first = await pollUntilSucceeded(provider, await provider.submit(request))
    const second = await pollUntilSucceeded(provider, await provider.submit(request))

    expect(first.seedUsed).not.toBe(second.seedUsed)
    const a = await readFile(outputPathOf(first))
    const b = await readFile(outputPathOf(second))
    expect(a.equals(b)).toBe(false)
  })

  it('seed を明示すれば尊重される（再現性のため）', async () => {
    const provider = createStubVideoProvider({ outputDir })
    const request = makeRequest(stubVeoLikeModel, makeSpec({ seed: 12345 }))

    const status = await pollUntilSucceeded(provider, await provider.submit(request))
    expect(status.seedUsed).toBe(12345)
  })
})
