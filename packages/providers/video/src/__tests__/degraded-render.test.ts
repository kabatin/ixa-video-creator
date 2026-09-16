import { join } from 'node:path'
import { probeMedia } from '@ixa/media'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { stubVeoLikeModel } from '../stub/descriptor.js'
import {
  resetDrawtextSupportCache,
  STUB_FORCE_NO_DRAWTEXT_ENV,
} from '../stub/ffmpeg-features.js'
import { createStubVideoProvider } from '../stub/provider.js'
import { renderPlaceholder } from '../stub/render-placeholder.js'
import {
  createTempDir,
  filePathFromUrl,
  makeRequest,
  makeSpec,
  pollUntilSucceeded,
  removeTempDir,
} from './fixtures.js'

const TEST_TIMEOUT_MS = 120_000

const baseInput = {
  durationSec: 4,
  width: 1280,
  height: 720,
  fps: 24,
  backgroundColor: '#2E1A4D',
  lines: ['shot 01ARZ3ND', 'medium_closeup', '4s @ 24fps'],
  signature: '382fcbde9a0011ff',
  seed: 42,
} as const

/**
 * drawtext を持たない FFmpeg ビルド（Homebrew の ffmpeg 9.x など）を想定した縮退の検証。
 * 判定結果を注入することで、drawtext があるマシンでも「無い環境」を再現できる。
 */
describe('drawtext が無い環境への縮退（実 ffmpeg）', () => {
  let outputDir = ''

  beforeAll(async () => {
    outputDir = await createTempDir()
  })

  afterAll(async () => {
    await removeTempDir(outputDir)
  })

  it(
    '例外にならず、尺・解像度・fps を守った動画を生成する',
    async () => {
      const outputPath = join(outputDir, 'degraded.mp4')
      const result = await renderPlaceholder(
        { ...baseInput, outputPath },
        { drawtextAvailable: false },
      )

      expect(result.mode).toBe('degraded_no_drawtext')

      const probe = await probeMedia(outputPath)
      expect(probe.durationSec).toBeCloseTo(4, 2)
      expect(probe.width).toBe(1280)
      expect(probe.height).toBe(720)
      expect(probe.fps).toBe(24)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '判定を注入しなければ実 ffmpeg の対応状況に従う',
    async () => {
      const outputPath = join(outputDir, 'auto.mp4')
      const result = await renderPlaceholder({ ...baseInput, outputPath })

      expect(['text', 'degraded_no_drawtext']).toContain(result.mode)
      expect((await probeMedia(outputPath)).durationSec).toBeCloseTo(4, 2)
    },
    TEST_TIMEOUT_MS,
  )
})

/**
 * 環境変数での強制縮退。drawtext を持つマシンでも「無い環境」の経路を通せるようにしてある。
 */
describe(`${STUB_FORCE_NO_DRAWTEXT_ENV} による強制縮退（実 ffmpeg）`, () => {
  let outputDir = ''

  beforeAll(async () => {
    outputDir = await createTempDir()
  })

  afterEach(() => {
    delete process.env[STUB_FORCE_NO_DRAWTEXT_ENV]
    resetDrawtextSupportCache()
  })

  afterAll(async () => {
    await removeTempDir(outputDir)
  })

  it(
    'Provider 経由の生成が縮退し、成功したことが poll で分かる',
    async () => {
      process.env[STUB_FORCE_NO_DRAWTEXT_ENV] = '1'

      const provider = createStubVideoProvider({ outputDir })
      const status = await pollUntilSucceeded(
        provider,
        await provider.submit(
          makeRequest(stubVeoLikeModel, makeSpec({ durationSec: 4, fps: 24, seed: 7 })),
        ),
      )

      expect(status.raw.renderMode).toBe('degraded_no_drawtext')

      const probe = await probeMedia(filePathFromUrl(status.outputUrl))
      expect(probe.durationSec).toBeCloseTo(4, 2)
      expect(probe.width).toBe(1280)
      expect(probe.height).toBe(720)
      expect(probe.fps).toBe(24)
    },
    TEST_TIMEOUT_MS,
  )
})
