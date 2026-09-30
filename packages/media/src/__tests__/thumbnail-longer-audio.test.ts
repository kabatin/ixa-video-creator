import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { probeMedia } from '../probe.js'
import {
  createThumbnail,
  extractLastFrame,
  extractPosterFrames,
  seekableDurationSec,
  thumbnailPositionSec,
} from '../thumbnail.js'
import { createTempDir, makeTestVideoWithLongerAudio, removeTempDir } from './fixtures.js'

/**
 * 音声が映像より長い動画の回帰テスト。
 *
 * コンテナの尺（durationSec）は音声に引っ張られて長くなる。それを基準に位置を決めると、
 * 映像がもう終わった位置を指してしまい、ffmpeg は 1 枚も書き出さない。
 * シーク位置だけは映像ストリームの尺を基準にする。
 */

const FFMPEG_TIMEOUT_MS = 120_000
/** 映像 1 秒（10fps で 10 フレーム）に対して音声 12 秒。尺の 10% 地点すら映像の外になる。 */
const VIDEO_SEC = 1
const AUDIO_SEC = 12
const FPS = 10

const sha256Of = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

describe('seekableDurationSec', () => {
  it('映像ストリームの尺があればそちらを使う', () => {
    expect(seekableDurationSec({ durationSec: 12, videoDurationSec: 1 })).toBe(1)
  })

  it('映像ストリームの尺が無ければコンテナの尺を使う', () => {
    expect(seekableDurationSec({ durationSec: 12, videoDurationSec: null })).toBe(12)
    expect(seekableDurationSec({ durationSec: 12 })).toBe(12)
  })
})

describe('thumbnailPositionSec（音声が映像より長い）', () => {
  it('映像の尺の 10% 地点を採る', () => {
    expect(thumbnailPositionSec({ durationSec: 12, videoDurationSec: 1, fps: 10 })).toBeCloseTo(
      0.1,
      6,
    )
  })
})

describe('音声が映像より長い動画（実 ffmpeg）', () => {
  let tempDir = ''
  let sourcePath = ''

  beforeAll(async () => {
    tempDir = await createTempDir()
    sourcePath = await makeTestVideoWithLongerAudio(join(tempDir, 'longer-audio.mp4'), {
      fps: FPS,
      videoSec: VIDEO_SEC,
      audioSec: AUDIO_SEC,
    })
  }, FFMPEG_TIMEOUT_MS)

  afterAll(async () => {
    await removeTempDir(tempDir)
  })

  it(
    'probe は durationSec にコンテナの尺、videoDurationSec に映像の尺を入れる',
    async () => {
      const probe = await probeMedia(sourcePath)

      expect(probe.durationSec).toBeCloseTo(AUDIO_SEC, 0)
      expect(probe.videoDurationSec).toBeCloseTo(VIDEO_SEC, 1)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '位置省略のサムネイルを映像の範囲から作る',
    async () => {
      const outputPath = join(tempDir, 'thumb.jpg')
      await createThumbnail(sourcePath, outputPath)

      expect((await stat(outputPath)).size).toBeGreaterThan(0)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    'ポスターフレームを映像の範囲に等間隔で作り、すべて別のフレームになる',
    async () => {
      const probe = await probeMedia(sourcePath)
      const paths = await extractPosterFrames(
        sourcePath,
        join(tempDir, 'posters'),
        5,
        seekableDurationSec(probe) ?? 0,
        probe.fps,
      )

      expect(paths).toHaveLength(5)
      const hashes = await Promise.all(paths.map(sha256Of))
      expect(new Set(hashes).size).toBe(5)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '最終フレームを映像の末尾から作る',
    async () => {
      const probe = await probeMedia(sourcePath)
      const outputPath = join(tempDir, 'last-frame.jpg')
      await extractLastFrame(sourcePath, outputPath, seekableDurationSec(probe) ?? 0, probe.fps)

      expect((await stat(outputPath)).size).toBeGreaterThan(0)
    },
    FFMPEG_TIMEOUT_MS,
  )
})
