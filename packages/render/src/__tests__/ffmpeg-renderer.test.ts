import type { TimelineDocument } from '@ixa/domain'
import { probeMedia, runFfmpeg } from '@ixa/media'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFfmpegRenderer } from '../ffmpeg-renderer.js'
import { makeDocument, makeVideo1Shot } from './fixtures.js'

/** 実 ffmpeg を叩く。素材生成 + エンコードで数十秒かかる。 */
const TEST_TIMEOUT_MS = 180_000

const FPS = 30
const SHOT_SEC = 2
const TOTAL_SEC = SHOT_SEC * 2

let workDir = ''
let shotA = ''
let shotB = ''
let toneA = ''
let toneB = ''

/** testsrc で短い動画を作る。素材の解像度はキャンバスとわざと変えてレターボックスも通す。 */
const makeTestVideo = async (path: string, pattern: string): Promise<void> => {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `${pattern}=size=320x240:rate=${FPS}:duration=${SHOT_SEC}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    path,
  ])
}

const makeTestTone = async (path: string, frequency: number): Promise<void> => {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=${SHOT_SEC}`,
    path,
  ])
}

/** 指定区間の平均音量（dBFS）。無音なら -inf に近い値になる。 */
const meanVolumeDb = async (path: string, startSec: number, durationSec: number): Promise<number> => {
  const { stderr } = await runFfmpeg([
    '-hide_banner',
    '-ss', String(startSec),
    '-t', String(durationSec),
    '-i', path,
    '-af', 'volumedetect',
    '-f', 'null',
    '-',
  ])
  const match = /mean_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(stderr)
  const value = match?.[1]
  if (value === undefined) throw new Error(`volumedetect の出力を解釈できません:\n${stderr}`)
  return value === '-inf' ? Number.NEGATIVE_INFINITY : Number.parseFloat(value)
}

const document = (): TimelineDocument =>
  makeDocument({
    fps: FPS,
    resolution: { width: 320, height: 240 },
    durationSec: TOTAL_SEC,
    video1: [makeVideo1Shot(1, 0, SHOT_SEC), makeVideo1Shot(2, SHOT_SEC, SHOT_SEC)].map(
      (shot, index) => ({ ...shot, mediaUrl: index === 0 ? shotA : shotB }),
    ),
    audio: [
      { mediaUrl: toneA, startSec: 0, durationSec: SHOT_SEC, volume: 1 },
      { mediaUrl: toneB, startSec: SHOT_SEC, durationSec: SHOT_SEC, volume: 1 },
    ],
  })

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ixa-render-'))
  shotA = join(workDir, 'shot-a.mp4')
  shotB = join(workDir, 'shot-b.mp4')
  toneA = join(workDir, 'tone-a.wav')
  toneB = join(workDir, 'tone-b.wav')

  await Promise.all([
    makeTestVideo(shotA, 'testsrc'),
    makeTestVideo(shotB, 'testsrc2'),
    makeTestTone(toneA, 440),
    makeTestTone(toneB, 880),
  ])
}, TEST_TIMEOUT_MS)

afterAll(async () => {
  if (workDir !== '') await rm(workDir, { recursive: true, force: true })
})

describe('createFfmpegRenderer', () => {
  it('capabilities で機能差を表明する（clips と cut 以外のトランジションは出せない）', () => {
    const renderer = createFfmpegRenderer({ outputDir: workDir })
    expect(renderer.id).toBe('ffmpeg')
    expect(renderer.capabilities).toEqual({
      motionGraphics: false,
      textAnimation: false,
      perClipEffects: false,
    })
  })

  it(
    '2 本の動画を 1 本の MP4 に連結し、尺・解像度・音声が揃う',
    async () => {
      const renderer = createFfmpegRenderer({ outputDir: join(workDir, 'out') })
      const progress: number[] = []
      const doc = document()

      const result = await renderer.render(doc, 'preview_720p', (p) => progress.push(p))

      expect(result.storageKey.endsWith('.mp4')).toBe(true)
      expect(result.bytes).toBeGreaterThan(0)
      expect(progress[0]).toBe(0)
      expect(progress[progress.length - 1]).toBe(1)

      const probe = await probeMedia(result.storageKey)

      // 出力の尺が TimelineDocument.durationSec と一致すること（許容は 1 フレーム）
      expect(probe.durationSec).not.toBeNull()
      expect(Math.abs((probe.durationSec ?? 0) - doc.durationSec)).toBeLessThanOrEqual(1 / FPS)
      expect(result.durationSec).toBeCloseTo(doc.durationSec, 1)

      // プリセット解像度が優先される
      expect(probe.width).toBe(1280)
      expect(probe.height).toBe(720)
      expect(probe.hasAudio).toBe(true)

      // 前半・後半のどちらにも音がある = 2 本の音声が混ざっている
      const first = await meanVolumeDb(result.storageKey, 0, SHOT_SEC)
      const second = await meanVolumeDb(result.storageKey, SHOT_SEC, SHOT_SEC)
      expect(first).toBeGreaterThan(-50)
      expect(second).toBeGreaterThan(-50)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '音声が無いタイムラインでも書き出せる',
    async () => {
      const renderer = createFfmpegRenderer({ outputDir: join(workDir, 'out-silent') })
      const doc = makeDocument({
        fps: FPS,
        resolution: { width: 320, height: 240 },
        durationSec: SHOT_SEC,
        video1: [{ ...makeVideo1Shot(1, 0, SHOT_SEC), mediaUrl: shotA }],
      })

      const result = await renderer.render(doc, 'preview_720p', () => undefined)
      const probe = await probeMedia(result.storageKey)
      expect(probe.hasAudio).toBe(false)
      expect(Math.abs((probe.durationSec ?? 0) - doc.durationSec)).toBeLessThanOrEqual(1 / FPS)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '素材が見つからなければ原因を含めて throw する（握り潰さない）',
    async () => {
      const renderer = createFfmpegRenderer({ outputDir: join(workDir, 'out-missing') })
      const doc = makeDocument({
        fps: FPS,
        durationSec: SHOT_SEC,
        video1: [{ ...makeVideo1Shot(1, 0, SHOT_SEC), mediaUrl: join(workDir, 'missing.mp4') }],
      })

      await expect(renderer.render(doc, 'preview_720p', () => undefined)).rejects.toThrow(
        /FFmpeg のレンダリングに失敗しました/,
      )
    },
    TEST_TIMEOUT_MS,
  )
})
