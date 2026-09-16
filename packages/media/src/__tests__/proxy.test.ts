import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { probeMedia } from '../probe.js'
import { createProxy } from '../proxy.js'
import { createTempDir, makeTestVideo, removeTempDir } from './fixtures.js'

const FFMPEG_TIMEOUT_MS = 120_000

describe('createProxy（実 ffmpeg）', () => {
  let tempDir = ''
  let source1080p = ''
  let source480p = ''
  let sourceSilent = ''

  beforeAll(async () => {
    tempDir = await createTempDir()
    source1080p = await makeTestVideo(join(tempDir, 'src-1080p.mp4'), {
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 1,
      withAudio: true,
    })
    source480p = await makeTestVideo(join(tempDir, 'src-480p.mp4'), {
      width: 854,
      height: 480,
      fps: 30,
      durationSec: 1,
      withAudio: true,
    })
    sourceSilent = await makeTestVideo(join(tempDir, 'src-silent.mp4'), {
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 1,
      withAudio: false,
    })
  }, FFMPEG_TIMEOUT_MS)

  afterAll(async () => {
    await removeTempDir(tempDir)
  })

  it(
    '1080p を 720p へ落とし、アスペクト比を保つ',
    async () => {
      const outputPath = join(tempDir, 'proxy-720.mp4')
      await createProxy(source1080p, outputPath)

      const source = await probeMedia(source1080p)
      const proxy = await probeMedia(outputPath)

      expect(proxy.height).toBe(720)
      expect(proxy.width).toBe(1280)
      expect(proxy.codec).toBe('h264')

      const sourceAspect = (source.width ?? 0) / (source.height ?? 1)
      const proxyAspect = (proxy.width ?? 0) / (proxy.height ?? 1)
      expect(proxyAspect).toBeCloseTo(sourceAspect, 2)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '480p の素材を 720p へ引き伸ばさない',
    async () => {
      const outputPath = join(tempDir, 'proxy-480.mp4')
      await createProxy(source480p, outputPath)

      const proxy = await probeMedia(outputPath)

      expect(proxy.height).toBe(480)
      expect(proxy.width).toBe(854)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '音声が無い素材に音声ストリームを作らない',
    async () => {
      const outputPath = join(tempDir, 'proxy-silent.mp4')
      await createProxy(sourceSilent, outputPath)

      const proxy = await probeMedia(outputPath)

      expect(proxy.hasAudio).toBe(false)
      expect(proxy.height).toBe(720)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    'maxHeight を指定すると、その高さ以下に収める',
    async () => {
      const outputPath = join(tempDir, 'proxy-360.mp4')
      await createProxy(source1080p, outputPath, { maxHeight: 360 })

      const proxy = await probeMedia(outputPath)

      expect(proxy.height).toBe(360)
      expect(proxy.width).toBe(640)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '音声を AAC として保持する',
    async () => {
      const outputPath = join(tempDir, 'proxy-audio.mp4')
      await createProxy(source1080p, outputPath)

      const proxy = await probeMedia(outputPath)
      expect(proxy.hasAudio).toBe(true)
    },
    FFMPEG_TIMEOUT_MS,
  )
})
