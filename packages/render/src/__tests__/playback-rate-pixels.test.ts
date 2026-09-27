import type { TimelineDocument } from '@ixa/domain'
import { measureLoudness, probeMedia, runFfmpeg } from '@ixa/media'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearBundleCache } from '../bundle-cache.js'
import { createRemotionRenderer } from '../renderer.js'
import { extractFrame, meanColor, type Rect } from './frame-probe.js'
import { makeDocument, makeVideo1Shot } from './fixtures.js'
import { startMediaServer, type MediaServer } from './media-server.js'

/**
 * 尺に合わせた速度と、Shot の音を鳴らさないこと（ADR-0026）を**実際の書き出し**で確かめる。
 * プレビューも同じ合成を通るので、ここで効けば両方で効く。
 *
 * 素材は「前半 1 秒が赤・後半 1 秒が青」で、1 kHz の音が入っている（Veo の動画は音付き）。
 * これを 4 秒の Shot に 0.5 倍で流すと、1.5 秒の時点は素材の 0.75 秒 = まだ赤。
 * 速度が効いていなければ素材の 1.5 秒 = 青になる。
 */
const RENDER_TIMEOUT_MS = 10 * 60 * 1000
const FPS = 12
const SOURCE = { width: 320, height: 240 } as const
const PATCH: Rect = { x: 600, y: 330, width: 80, height: 60 }

let workDir = ''
let outputPath = ''
let server: MediaServer | null = null

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ixa-playback-rate-'))
  await runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', `color=c=0xff0000:size=${SOURCE.width}x${SOURCE.height}:rate=${FPS}:duration=1`,
    '-f', 'lavfi', '-i', `color=c=0x0000ff:size=${SOURCE.width}x${SOURCE.height}:rate=${FPS}:duration=1`,
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-map', '2:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    join(workDir, 'red-blue.mp4'),
  ])
  server = await startMediaServer(workDir)
  const doc: TimelineDocument = makeDocument({
    fps: FPS,
    resolution: { ...SOURCE },
    durationSec: 4,
    video1: [{ ...makeVideo1Shot(1, 0, 4), mediaUrl: server.urlFor(join(workDir, 'red-blue.mp4')), playbackRate: 0.5 }],
    transitions: [],
    clips: [],
    audio: [],
  })
  const result = await createRemotionRenderer({ outputDir: join(workDir, 'out') }).render(doc, 'preview_720p', () => undefined)
  outputPath = result.storageKey
}, RENDER_TIMEOUT_MS)

afterAll(async () => {
  clearBundleCache()
  if (server !== null) await server.close()
  if (workDir !== '') await rm(workDir, { recursive: true, force: true })
})

describe('再生速度（書き出し）', () => {
  it('0.5 倍なら 1.5 秒の時点は素材の 0.75 秒（赤）', async () => {
    const color = meanColor(await extractFrame(outputPath, 1.5, workDir), PATCH)
    expect(color.r).toBeGreaterThan(180)
    expect(color.b).toBeLessThan(80)
  })

  it('3 秒の時点で素材の 1.5 秒（青）に進む', async () => {
    const color = meanColor(await extractFrame(outputPath, 3, workDir), PATCH)
    expect(color.b).toBeGreaterThan(180)
    expect(color.r).toBeLessThan(80)
  })
})

describe('Shot の音は鳴らさない（音は曲）', () => {
  it('素材に音があっても、書き出しは無音', async () => {
    const probe = await probeMedia(outputPath)
    if (!probe.hasAudio) return
    const loudness = await measureLoudness(outputPath)
    expect(loudness.truePeakDb).toBeLessThan(-50)
  })
})
