import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FfmpegError } from '../ffmpeg-runner.js'
import { probeMedia, toMediaProbe } from '../probe.js'
import { createTempDir, makeTestAudio, makeTestVideo, removeTempDir } from './fixtures.js'

const FFMPEG_TIMEOUT_MS = 60_000

describe('toMediaProbe', () => {
  it('動画ストリームが無ければ width / height / fps を null にする', () => {
    const probe = toMediaProbe(
      JSON.stringify({
        streams: [{ codec_type: 'audio', codec_name: 'aac', duration: '3.0' }],
        format: { duration: '3.0' },
      }),
    )

    expect(probe).toEqual({
      durationSec: 3,
      width: null,
      height: null,
      fps: null,
      hasAudio: true,
      codec: 'aac',
    })
  })

  it('"N/A" の duration を null に落とす', () => {
    const probe = toMediaProbe(JSON.stringify({ streams: [], format: { duration: 'N/A' } }))
    expect(probe.durationSec).toBeNull()
    expect(probe.hasAudio).toBe(false)
  })

  it('r_frame_rate が "0/0" でも avg_frame_rate から fps を拾う', () => {
    const probe = toMediaProbe(
      JSON.stringify({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            r_frame_rate: '0/0',
            avg_frame_rate: '30000/1001',
          },
        ],
        format: { duration: '2.0' },
      }),
    )
    expect(probe.fps).toBeCloseTo(29.97, 2)
  })
})

describe('probeMedia（実 ffprobe）', () => {
  let tempDir = ''
  let videoPath = ''
  let silentPath = ''
  let audioPath = ''

  beforeAll(async () => {
    tempDir = await createTempDir()
    videoPath = await makeTestVideo(join(tempDir, 'video.mp4'), {
      width: 1280,
      height: 720,
      fps: 30,
      durationSec: 2,
      withAudio: true,
    })
    silentPath = await makeTestVideo(join(tempDir, 'silent.mp4'), {
      width: 640,
      height: 360,
      fps: 25,
      durationSec: 1,
      withAudio: false,
    })
    audioPath = await makeTestAudio(join(tempDir, 'audio.m4a'), 1)
  }, FFMPEG_TIMEOUT_MS)

  afterAll(async () => {
    await removeTempDir(tempDir)
  })

  it(
    '解像度・fps・尺・音声有無を取得する',
    async () => {
      const probe = await probeMedia(videoPath)

      expect(probe.width).toBe(1280)
      expect(probe.height).toBe(720)
      expect(probe.fps).toBeCloseTo(30, 2)
      expect(probe.durationSec).toBeCloseTo(2, 1)
      expect(probe.hasAudio).toBe(true)
      expect(probe.codec).toBe('h264')
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '音声が無い動画では hasAudio が false になる',
    async () => {
      const probe = await probeMedia(silentPath)

      expect(probe.hasAudio).toBe(false)
      expect(probe.width).toBe(640)
      expect(probe.height).toBe(360)
      expect(probe.fps).toBeCloseTo(25, 2)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '音声のみのファイルでは映像メタデータが null になる',
    async () => {
      const probe = await probeMedia(audioPath)

      expect(probe.width).toBeNull()
      expect(probe.height).toBeNull()
      expect(probe.fps).toBeNull()
      expect(probe.hasAudio).toBe(true)
      expect(probe.durationSec).toBeCloseTo(1, 1)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '存在しないファイルでは FfmpegError を throw する',
    async () => {
      await expect(probeMedia(join(tempDir, 'missing.mp4'))).rejects.toBeInstanceOf(FfmpegError)
    },
    FFMPEG_TIMEOUT_MS,
  )
})
