import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryStorage } from '@ixa/storage'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readBytes } from '../../media/__tests__/doubles.js'
import { makeTestVideo } from '../../media/__tests__/fixtures.js'
import { REVIEW_FRAME_SAMPLE_COUNT, createFfmpegMeasurer } from '../measure.js'
import { aProject, aShot, aTake, aVideoAsset, silentLogger } from './doubles.js'

/**
 * 実 ffmpeg で測定器を通す。ストレージはメモリ上の実装を使う。
 *
 * 音声が映像より長い動画では、コンテナの尺（durationSec）が音声の尺になる。
 * それを基準にフレームを抜くと映像の外を指し、技術チェックの測定が失敗していた。
 */

const FFMPEG_TIMEOUT_MS = 120_000
const VIDEO_SEC = 1
const AUDIO_SEC = 12

let fixtureDir: string
let workDir: string
let longerAudioVideoBytes: Uint8Array

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'ixa-review-fixture-'))
  workDir = await mkdtemp(join(tmpdir(), 'ixa-review-work-'))
  longerAudioVideoBytes = await readBytes(
    await makeTestVideo(fixtureDir, VIDEO_SEC, {
      fileName: 'longer-audio.mp4',
      audioSec: AUDIO_SEC,
    }),
  )
}, FFMPEG_TIMEOUT_MS)

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
  await rm(workDir, { recursive: true, force: true })
})

describe('createFfmpegMeasurer（実 ffmpeg）', () => {
  it(
    '音声が映像より長い動画でも、映像の範囲からフレームを抜く',
    async () => {
      const storage = createMemoryStorage()
      const project = aProject()
      const shot = aShot(project)
      const asset = aVideoAsset(project)
      await storage.put(asset.storageKey, longerAudioVideoBytes, { contentType: 'video/mp4' })

      const measure = createFfmpegMeasurer({ storage, workDir, logger: silentLogger })
      const result = await measure({
        take: aTake(shot, asset.id),
        shot,
        project,
        asset,
        musicAnalysis: null,
        brandColors: [],
      })

      // 尺の判定はコンテナの尺のまま（音声も含めた長さ）。
      expect(result.video.durationSec).toBeCloseTo(AUDIO_SEC, 0)
      expect(result.frames).toHaveLength(REVIEW_FRAME_SAMPLE_COUNT)
      for (const frame of result.frames) {
        expect(frame.atSec).toBeLessThan(VIDEO_SEC)
        expect(Number.isFinite(frame.meanLuma)).toBe(true)
        expect(frame.meanLuma).toBeGreaterThan(0)
      }
    },
    FFMPEG_TIMEOUT_MS,
  )
})
