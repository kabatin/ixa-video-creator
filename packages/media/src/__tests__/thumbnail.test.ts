import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { probeMedia } from '../probe.js'
import {
  createThumbnail,
  extractPosterFrames,
  posterFrameFileName,
  posterFramePositions,
} from '../thumbnail.js'
import { createTempDir, makeTestVideo, removeTempDir } from './fixtures.js'

const FFMPEG_TIMEOUT_MS = 120_000
const SOURCE_DURATION_SEC = 4

describe('posterFramePositions', () => {
  it('先頭 0 秒と末尾ぴったりを避け、等間隔に並べる', () => {
    expect(posterFramePositions(10, 4)).toEqual([2, 4, 6, 8])
  })

  it('1 枚なら中央を採る', () => {
    expect(posterFramePositions(10, 1)).toEqual([5])
  })

  it('隣り合う位置の間隔が一定になる', () => {
    const positions = posterFramePositions(12, 5)
    const gaps = positions.slice(1).map((position, index) => position - (positions[index] ?? 0))
    for (const gap of gaps) expect(gap).toBeCloseTo(2, 6)
  })

  it('不正な尺・枚数を拒否する', () => {
    expect(() => posterFramePositions(0, 3)).toThrow()
    expect(() => posterFramePositions(10, 0)).toThrow()
    expect(() => posterFramePositions(10, 1.5)).toThrow()
  })
})

describe('posterFrameFileName', () => {
  it('3 桁ゼロ埋めする', () => {
    expect(posterFrameFileName(0)).toBe('poster-000.jpg')
    expect(posterFrameFileName(7)).toBe('poster-007.jpg')
    expect(posterFrameFileName(123)).toBe('poster-123.jpg')
  })
})

describe('createThumbnail / extractPosterFrames（実 ffmpeg）', () => {
  let tempDir = ''
  let sourcePath = ''

  beforeAll(async () => {
    tempDir = await createTempDir()
    sourcePath = await makeTestVideo(join(tempDir, 'source.mp4'), {
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: SOURCE_DURATION_SEC,
      withAudio: false,
    })
  }, FFMPEG_TIMEOUT_MS)

  afterAll(async () => {
    await removeTempDir(tempDir)
  })

  it(
    '幅 640 の JPEG を生成する',
    async () => {
      const outputPath = join(tempDir, 'thumb.jpg')
      await createThumbnail(sourcePath, outputPath)

      const probe = await probeMedia(outputPath)
      expect(probe.width).toBe(640)
      expect(probe.height).toBe(360)
      expect((await stat(outputPath)).size).toBeGreaterThan(0)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    'atSec を指定しても生成できる',
    async () => {
      const outputPath = join(tempDir, 'thumb-at.jpg')
      await createThumbnail(sourcePath, outputPath, 3)

      expect((await stat(outputPath)).size).toBeGreaterThan(0)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '指定枚数のポスターフレームを 3 桁ゼロ埋めで生成する',
    async () => {
      const outputDir = join(tempDir, 'posters')
      const paths = await extractPosterFrames(sourcePath, outputDir, 3, SOURCE_DURATION_SEC)

      expect(paths).toHaveLength(3)
      expect(paths).toEqual([
        join(outputDir, 'poster-000.jpg'),
        join(outputDir, 'poster-001.jpg'),
        join(outputDir, 'poster-002.jpg'),
      ])

      const entries = await readdir(outputDir)
      expect(entries.sort()).toEqual(['poster-000.jpg', 'poster-001.jpg', 'poster-002.jpg'])

      for (const path of paths) {
        expect((await stat(path)).size).toBeGreaterThan(0)
      }
    },
    FFMPEG_TIMEOUT_MS,
  )

  it('抽出位置が 0 秒でも尺ぴったりでもない', () => {
    const positions = posterFramePositions(SOURCE_DURATION_SEC, 3)

    for (const position of positions) {
      expect(position).toBeGreaterThan(0)
      expect(position).toBeLessThan(SOURCE_DURATION_SEC)
    }
  })
})
