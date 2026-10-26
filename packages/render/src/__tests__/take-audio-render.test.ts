import type { TimelineDocument } from '@ixa/domain'
import { probeMedia, runFfmpeg } from '@ixa/media'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearBundleCache } from '../bundle-cache.js'
import { createFfmpegRenderer } from '../ffmpeg-renderer.js'
import { createRemotionRenderer } from '../renderer.js'
import { makeDocument, makeVideo1Shot } from './fixtures.js'
import { startMediaServer, type MediaServer } from './media-server.js'

/**
 * **持ち込んだ音付きの Take の音が、書き出しに出る**（ADR-0060）。実 ffmpeg・実 Remotion で 1 本ずつ書き出して音を測る。
 *
 * 素材は 1kHz の音が入った mp4（`import_take` で持ち込む動画と同じ形。probe が `hasAudio: true` を付ける）。
 * 同じ素材を 2 つの Shot に置き、前は鳴らし（`audio` あり）、後ろは鳴らさない（前からの MV の Shot と同じ）。
 */

const RENDER_TIMEOUT_MS = 10 * 60 * 1000
const SETUP_TIMEOUT_MS = 3 * 60 * 1000

const FPS = 12
const SHOT_SEC = 2
const TOTAL_SEC = SHOT_SEC * 2

let workDir = ''
let tonePath = ''
let server: MediaServer | null = null

/** 1kHz の音と testsrc の絵の mp4。 */
const makeToneVideo = async (path: string): Promise<void> => {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=${FPS}:duration=${SHOT_SEC + 1}`,
    '-f', 'lavfi', '-i', `sine=frequency=1000:sample_rate=48000:duration=${SHOT_SEC + 1}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    path,
  ])
}

/** 区間の平均音量（dBFS）。無音・音の無い区間（音のトラックがそこまで届かない）なら -inf。 */
const meanVolumeDb = async (path: string, startSec: number, durationSec: number): Promise<number> => {
  const { stderr } = await runFfmpeg([
    '-hide_banner', '-ss', String(startSec), '-t', String(durationSec), '-i', path, '-af', 'volumedetect', '-f', 'null', '-',
  ])
  const value = /mean_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(stderr)?.[1]
  // 測るものが無ければ平均は出ない（n_samples: 0 だけが出る）。
  if (value === undefined && /n_samples:\s*0\b/.test(stderr)) return Number.NEGATIVE_INFINITY
  if (value === undefined) throw new Error(`volumedetect の出力を解釈できません:\n${stderr}`)
  return value === '-inf' ? Number.NEGATIVE_INFINITY : Number.parseFloat(value)
}

const documentFor = (mediaUrl: string): TimelineDocument =>
  makeDocument({
    fps: FPS,
    resolution: { width: 320, height: 240 },
    durationSec: TOTAL_SEC,
    video1: [
      { ...makeVideo1Shot(1, 0, SHOT_SEC), mediaUrl, audio: { volume: 1 } },
      { ...makeVideo1Shot(2, SHOT_SEC, SHOT_SEC), mediaUrl },
    ],
  })

/** 前の Shot では鳴り、後ろの Shot では鳴らない（頭と尻のフェードを避けて真ん中を測る）。 */
const expectToneOnlyInFirstShot = async (path: string): Promise<void> => {
  const probe = await probeMedia(path)
  expect(probe.hasAudio).toBe(true)
  expect(await meanVolumeDb(path, 0.2, SHOT_SEC - 0.4)).toBeGreaterThan(-30)
  expect(await meanVolumeDb(path, SHOT_SEC + 0.2, SHOT_SEC - 0.4)).toBeLessThan(-60)
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ixa-take-audio-'))
  tonePath = join(workDir, 'tone.mp4')
  await makeToneVideo(tonePath)
  server = await startMediaServer(workDir)
}, SETUP_TIMEOUT_MS)

afterAll(async () => {
  clearBundleCache()
  if (server !== null) await server.close()
  if (workDir !== '') await rm(workDir, { recursive: true, force: true })
})

describe('持ち込んだ音付きの Take', () => {
  it('素材の probe は音があると言う（import_take が記録する値）', async () => {
    expect((await probeMedia(tonePath)).hasAudio).toBe(true)
  })

  it(
    '退避用の書き出し（ffmpeg）に、鳴らす Shot の音だけが出る',
    async () => {
      const renderer = createFfmpegRenderer({ outputDir: join(workDir, 'ffmpeg'), onOmittedEffects: () => undefined })
      const result = await renderer.render(documentFor(tonePath), 'preview_720p', () => undefined)
      await expectToneOnlyInFirstShot(result.storageKey)
    },
    RENDER_TIMEOUT_MS,
  )

  it(
    '書き出し（Remotion）に、鳴らす Shot の音だけが出る',
    async () => {
      if (server === null) throw new Error('メディアサーバが起動していません')
      const renderer = createRemotionRenderer({ outputDir: join(workDir, 'remotion') })
      const result = await renderer.render(documentFor(server.urlFor(tonePath)), 'preview_720p', () => undefined)
      await expectToneOnlyInFirstShot(result.storageKey)
    },
    RENDER_TIMEOUT_MS,
  )
})
