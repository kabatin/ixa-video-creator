import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractAudio, measureLoudness, parseEbur128Summary } from '../audio.js'
import { FfmpegError } from '../ffmpeg-runner.js'
import { probeMedia } from '../probe.js'
import { createTempDir, makeTestVideo, removeTempDir } from './fixtures.js'

const FFMPEG_TIMEOUT_MS = 120_000

const SUMMARY_SAMPLE = `[Parsed_ebur128_0 @ 0x600001] t: 1.2  M: -22.8 S: -22.9
[Parsed_ebur128_0 @ 0x600001] Summary:

  Integrated loudness:
    I:         -23.1 LUFS
    Threshold: -33.6 LUFS

  Loudness range:
    LRA:         0.4 LU

  True peak:
    Peak:       -1.5 dBFS
`

describe('parseEbur128Summary', () => {
  it('統合ラウドネスとトゥルーピークを取り出す', () => {
    expect(parseEbur128Summary(SUMMARY_SAMPLE)).toEqual({
      integratedLufs: -23.1,
      truePeakDb: -1.5,
    })
  })

  it('無音の "-inf" を -Infinity として扱う', () => {
    const silent = SUMMARY_SAMPLE.replace('-23.1 LUFS', '-inf LUFS').replace(
      '-1.5 dBFS',
      '-inf dBFS',
    )
    expect(parseEbur128Summary(silent)).toEqual({
      integratedLufs: Number.NEGATIVE_INFINITY,
      truePeakDb: Number.NEGATIVE_INFINITY,
    })
  })

  it('Summary が無ければ null を返す', () => {
    expect(parseEbur128Summary('')).toBeNull()
    expect(parseEbur128Summary('[info] nothing useful here')).toBeNull()
  })
})

describe('extractAudio / measureLoudness（実 ffmpeg）', () => {
  let tempDir = ''
  let withAudioPath = ''
  let silentPath = ''

  beforeAll(async () => {
    tempDir = await createTempDir()
    withAudioPath = await makeTestVideo(join(tempDir, 'with-audio.mp4'), {
      width: 640,
      height: 360,
      fps: 30,
      durationSec: 2,
      withAudio: true,
    })
    silentPath = await makeTestVideo(join(tempDir, 'no-audio.mp4'), {
      width: 640,
      height: 360,
      fps: 30,
      durationSec: 2,
      withAudio: false,
    })
  }, FFMPEG_TIMEOUT_MS)

  afterAll(async () => {
    await removeTempDir(tempDir)
  })

  it(
    '48kHz モノラルの WAV を書き出す',
    async () => {
      const outputPath = join(tempDir, 'audio.wav')
      await extractAudio(withAudioPath, outputPath)

      const probe = await probeMedia(outputPath)
      expect(probe.hasAudio).toBe(true)
      expect(probe.width).toBeNull()
      expect(probe.codec).toBe('pcm_s16le')
      expect(probe.durationSec).toBeCloseTo(2, 1)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '440Hz サイン波のラウドネスを計測する',
    async () => {
      const measurement = await measureLoudness(withAudioPath)

      expect(Number.isFinite(measurement.integratedLufs)).toBe(true)
      expect(measurement.integratedLufs).toBeLessThan(0)
      expect(measurement.integratedLufs).toBeGreaterThan(-70)
      expect(measurement.truePeakDb).toBeLessThanOrEqual(3)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '音声ストリームが無ければ FfmpegError を throw する',
    async () => {
      await expect(measureLoudness(silentPath)).rejects.toBeInstanceOf(FfmpegError)
    },
    FFMPEG_TIMEOUT_MS,
  )
})
