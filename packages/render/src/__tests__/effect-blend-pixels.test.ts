import type { TimelineDocument } from '@ixa/domain'
import { runFfmpeg } from '@ixa/media'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearBundleCache } from '../bundle-cache.js'
import { createRemotionRenderer } from '../renderer.js'
import { countPixels, extractFrame, meanColor, type Frame, type Rect } from './frame-probe.js'
import { makeClip, makeDocument, makeVideo1Shot } from './fixtures.js'
import { startMediaServer, type MediaServer } from './media-server.js'

/**
 * **混ぜ方（screen・difference）が下の絵に届いているか**をピクセルで確かめる（2026-10-17 のレビュー）。
 *
 * 以前は zIndex と opacity の入れ物を被せていたので、混ぜ方が透明な入れ物とだけ混ざり、
 * 光漏れ・フィルム焼けは青い絵の上でただ濁った（青が減った）。screen は下の色を減らさないので、
 * **青い絵の青はそのまま残り、赤だけが足される**はず。グリッチの白い帯は difference で下の色を反転する
 * （青 → 黄）。不透明度 0.9 でも反転が消えないこと。長いタイトルが映像の端で切れないことも見る。
 *
 * 素材は青一色。320x240 は 960x720 になり、映像の枠は x=160〜1120。
 */

const RENDER_TIMEOUT_MS = 10 * 60 * 1000
const SETUP_TIMEOUT_MS = 3 * 60 * 1000

const FPS = 12
const TOTAL_SEC = 4
const SOURCE = { width: 320, height: 240 } as const

const VIDEO_RECT: Rect = { x: 170, y: 10, width: 940, height: 700 }
/** 映像の左右の端。長いタイトルが切れていれば、ここに白い字がかかる。 */
const LEFT_EDGE: Rect = { x: 162, y: 200, width: 40, height: 320 }
const RIGHT_EDGE: Rect = { x: 1078, y: 200, width: 40, height: 320 }
const CENTER_BAND: Rect = { x: 400, y: 330, width: 480, height: 60 }

const atFrame = (frame: number): number => Math.max(0, (frame - 0.5) / FPS)

let workDir = ''
let outputPath = ''
let server: MediaServer | null = null
const bluePath = (): string => join(workDir, 'blue.mp4')

const effect = (n: number, templateKey: string, startSec: number, durationSec: number, params: Record<string, unknown>, opacity = 1) => ({
  ...makeClip(n, 'VFX', startSec, durationSec, 0, { type: 'motion_graphics', templateKey, params }),
  opacity,
})

const buildDocument = (media: MediaServer): TimelineDocument =>
  makeDocument({
    fps: FPS,
    resolution: { ...SOURCE },
    durationSec: TOTAL_SEC,
    video1: [{ ...makeVideo1Shot(1, 0, TOTAL_SEC), mediaUrl: media.urlFor(bluePath()) }],
    transitions: [],
    clips: [
      effect(1, 'light_leak', 0, 1, { intensity: 1, hue: 20 }),
      effect(2, 'film_burn', 1, 1, { intensity: 1 }),
      effect(3, 'glitch', 2, 1, { intensity: 1, rgbSplit: 1 }, 0.9),
      effect(4, 'title_card', 3, 1, { text: '速'.repeat(40), entrance: 'fade' }),
    ],
    audio: [],
  })

const frameAt = (index: number): Promise<Frame> => {
  if (outputPath === '') throw new Error('レンダリングが完了していないためフレームを取り出せません')
  return extractFrame(outputPath, atFrame(index), workDir)
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ixa-effect-blend-'))
  await runFfmpeg([
    '-y', '-f', 'lavfi',
    '-i', `color=c=0x0000ff:size=${String(SOURCE.width)}x${String(SOURCE.height)}:rate=${String(FPS)}:duration=${String(TOTAL_SEC)}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', bluePath(),
  ])
  server = await startMediaServer(workDir)
}, SETUP_TIMEOUT_MS)

afterAll(async () => {
  clearBundleCache()
  if (server !== null) await server.close()
  if (workDir !== '') await rm(workDir, { recursive: true, force: true })
})

const lostBlue = (frame: Frame): number => countPixels(frame, VIDEO_RECT, (p) => p.b < 200)
const warmed = (frame: Frame): number => countPixels(frame, VIDEO_RECT, (p) => p.r > 80)

describe('エフェクトの混ぜ方のピクセル検証', () => {
  it(
    '光漏れ・フィルム焼け・グリッチ・長いタイトルを載せた 1 本を書き出す',
    async () => {
      if (server === null) throw new Error('メディアサーバが起動していません')
      const result = await createRemotionRenderer({ outputDir: join(workDir, 'out') }).render(
        buildDocument(server),
        'preview_720p',
        () => undefined,
      )
      outputPath = result.storageKey
      expect(result.bytes).toBeGreaterThan(0)
    },
    RENDER_TIMEOUT_MS,
  )

  it.each([
    ['光漏れ', 6],
    ['フィルム焼け', 18],
  ] as const)('%s は screen で下の絵に足される（青は減らず、赤だけが乗る）', async (_name, index) => {
    const frame = await frameAt(index)
    expect(warmed(frame)).toBeGreaterThan(2000)
    expect(lostBlue(frame)).toBeLessThan(VIDEO_RECT.width * VIDEO_RECT.height * 0.01)
  })

  it('グリッチの白い帯は不透明度 0.9 でも下の絵を反転する（青 → 黄）', async () => {
    const frames = await Promise.all([24, 25, 26, 27, 28, 29, 30, 31, 32, 33].map((index) => frameAt(index)))
    const yellow = frames.map((frame) => countPixels(frame, VIDEO_RECT, (p) => p.r > 170 && p.g > 170 && p.b < 100))
    expect(Math.max(...yellow)).toBeGreaterThan(500)
  })

  it('40 字のタイトルは映像の端で切れない（端に白い字がかからず、真ん中に出る）', async () => {
    const frame = await frameAt(42)
    const white = (p: { r: number; g: number; b: number }): boolean => p.r > 200 && p.g > 200 && p.b > 200
    expect(countPixels(frame, CENTER_BAND, white)).toBeGreaterThan(300)
    expect(countPixels(frame, LEFT_EDGE, white)).toBe(0)
    expect(countPixels(frame, RIGHT_EDGE, white)).toBe(0)
    expect(meanColor(frame, LEFT_EDGE).b).toBeGreaterThan(150)
  })
})
