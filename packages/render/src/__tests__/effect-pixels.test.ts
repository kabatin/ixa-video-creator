import type { TimelineDocument } from '@ixa/domain'
import { runFfmpeg } from '@ixa/media'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearBundleCache } from '../bundle-cache.js'
import { createRemotionRenderer } from '../renderer.js'
import { countPixels, extractFrame, meanColor, type Frame, type Rect } from './frame-probe.js'
import { makeClip, makeDocument, makeTransition, makeVideo1Shot, shotId } from './fixtures.js'
import { startMediaServer, type MediaServer } from './media-server.js'

/**
 * **エフェクト（ADR-0050）が書き出しの絵に本当に出ているかをピクセルで確かめる。**
 *
 * `effects.test.tsx` が見ているのは HTML と style の値で、Chrome が `clip-path`・SVG のフィルタ・
 * `transform` を描いたかではない。レンダリングは 1 回だけで、時間で分けて 1 本に載せる。
 *
 * 素材は青地の左 1/4 だけ赤い絵。320x240 は 960x720 になり、映像の枠は x=160〜1120、赤の右端は x=400。
 */

const RENDER_TIMEOUT_MS = 10 * 60 * 1000
const SETUP_TIMEOUT_MS = 3 * 60 * 1000

const FPS = 12
const TOTAL_SEC = 5
const SOURCE = { width: 320, height: 240 } as const

/** 赤の右端（x=400）のすぐ右。素の絵では青。寄ると赤の端が左へ下がって青のまま、流すと赤が来る。 */
const RIGHT_OF_EDGE: Rect = { x: 410, y: 300, width: 40, height: 120 }
/** 赤の右端のすぐ左。素の絵では赤。寄る（1.4 倍）と赤の端が x=304 へ下がり、青になる。 */
const LEFT_OF_EDGE: Rect = { x: 320, y: 300, width: 60, height: 120 }
/** 左の黒帯。寄っても絵がはみ出さないこと。 */
const LETTERBOX: Rect = { x: 20, y: 300, width: 120, height: 120 }
/** 赤の端のすぐ右の、画面の上端（スピード線が周りをぼかす場所）と、高さの真ん中（空ける場所）。 */
const RIGHT_OF_EDGE_TOP: Rect = { x: 402, y: 6, width: 12, height: 24 }
const RIGHT_OF_EDGE_MIDDLE: Rect = { x: 404, y: 340, width: 12, height: 40 }
/** 画面の中央。タイトルカードの文字が来る場所。 */
const CENTER_BAND: Rect = { x: 540, y: 320, width: 200, height: 80 }

const atFrame = (frame: number): number => Math.max(0, (frame - 0.5) / FPS)

let workDir = ''
let outputPath = ''
let server: MediaServer | null = null

const splitPath = (): string => join(workDir, 'split.mp4')

const makeSplitVideo = async (): Promise<void> => {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x0000ff:size=${String(SOURCE.width)}x${String(SOURCE.height)}:rate=${String(FPS)}:duration=${String(TOTAL_SEC)},drawbox=x=0:y=0:w=80:h=240:color=0xff0000:t=fill`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    splitPath(),
  ])
}

const effect = (n: number, templateKey: string, startSec: number, durationSec: number, params: Record<string, unknown>) =>
  makeClip(n, 'VFX', startSec, durationSec, 0, { type: 'motion_graphics', templateKey, params })

/**
 * ```
 * 0      0.25-0.5 フラッシュ（白）
 * 0.75-1.25      タイトルカード
 * 1.33-1.67      寄りのパンチ（1.4 倍、頭で寄りきる）
 * 2.0            whip_pan（0.5 秒。コマ 21〜26、境目 24）
 * 3.0            glitch（0.5 秒。コマ 33〜38、境目 36）
 * 4.0-5.0        スピード線（横・強さ 1。コマ 54 が真ん中）
 * ```
 */
const buildDocument = (media: MediaServer): TimelineDocument =>
  makeDocument({
    fps: FPS,
    resolution: { ...SOURCE },
    durationSec: TOTAL_SEC,
    video1: [
      { ...makeVideo1Shot(1, 0, 2), mediaUrl: media.urlFor(splitPath()) },
      { ...makeVideo1Shot(2, 2, 1), mediaUrl: media.urlFor(splitPath()) },
      { ...makeVideo1Shot(3, 3, 1), mediaUrl: media.urlFor(splitPath()) },
      { ...makeVideo1Shot(4, 4, 1), mediaUrl: media.urlFor(splitPath()) },
    ],
    transitions: [
      makeTransition(1, shotId(1), shotId(2), 'whip_pan', 0.5),
      makeTransition(2, shotId(2), shotId(3), 'glitch', 0.5),
    ],
    clips: [
      effect(1, 'flash', 0.25, 0.25, { color: '#ffffff', intensity: 1, attackSec: 0, decaySec: 1 }),
      effect(2, 'title_card', 0.75, 0.5, { text: 'IXA' }),
      effect(3, 'zoom_punch', 16 / FPS, 4 / FPS, { scale: 1.4, peakAtSec: 0, decaySec: 3 }),
      effect(4, 'speed_lines', 4, 1, { direction: 'horizontal', intensity: 1, density: 0 }),
    ],
    audio: [],
  })

const frameAt = (index: number): Promise<Frame> => {
  if (outputPath === '') throw new Error('レンダリングが完了していないためフレームを取り出せません')
  return extractFrame(outputPath, atFrame(index), workDir)
}

const isWhitish = (pixel: { r: number; g: number; b: number }): boolean =>
  pixel.r > 200 && pixel.g > 200 && pixel.b > 200

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ixa-effect-pixels-'))
  await makeSplitVideo()
  server = await startMediaServer(workDir)
}, SETUP_TIMEOUT_MS)

afterAll(async () => {
  clearBundleCache()
  if (server !== null) await server.close()
  if (workDir !== '') await rm(workDir, { recursive: true, force: true })
})

describe('エフェクトのピクセル検証', () => {
  it(
    'エフェクトを載せた 1 本を書き出す',
    async () => {
      if (server === null) throw new Error('メディアサーバが起動していません')
      const renderer = createRemotionRenderer({ outputDir: join(workDir, 'out') })
      const result = await renderer.render(buildDocument(server), 'preview_720p', () => undefined)
      outputPath = result.storageKey
      expect(result.bytes).toBeGreaterThan(0)
    },
    RENDER_TIMEOUT_MS,
  )

  it('素の絵では、赤の端の左は赤・右は青', async () => {
    const plain = await frameAt(7)
    expect(meanColor(plain, LEFT_OF_EDGE).r).toBeGreaterThan(180)
    expect(meanColor(plain, RIGHT_OF_EDGE).b).toBeGreaterThan(180)
  })

  it('フラッシュは画面を白く覆う', async () => {
    const frame = await frameAt(3)
    expect(countPixels(frame, RIGHT_OF_EDGE, isWhitish)).toBeGreaterThan(1000)
  })

  it('タイトルカードは真ん中に白い文字を出す', async () => {
    const [withTitle, withoutTitle] = await Promise.all([frameAt(12), frameAt(20)])
    expect(countPixels(withTitle, CENTER_BAND, isWhitish)).toBeGreaterThan(200)
    expect(countPixels(withoutTitle, CENTER_BAND, isWhitish)).toBeLessThan(20)
  })

  it('寄りのパンチは絵を寄せ（赤の端が左へ下がる）、黒帯へはみ出さない', async () => {
    const zoomed = await frameAt(16)
    const left = meanColor(zoomed, LEFT_OF_EDGE)
    expect(left.b).toBeGreaterThan(left.r)
    const bar = meanColor(zoomed, LETTERBOX)
    expect(bar.r + bar.g + bar.b).toBeLessThan(60)
  })

  it('whip_pan は境目で絵を右から流し込む（赤の端が右へ来る）', async () => {
    const [whip, after] = await Promise.all([frameAt(24), frameAt(30)])
    const moved = meanColor(whip, RIGHT_OF_EDGE)
    expect(moved.r).toBeGreaterThan(moved.b)
    expect(meanColor(after, RIGHT_OF_EDGE).b).toBeGreaterThan(180)
  })

  it('glitch は境目で絵を乱す（素の絵と違う）', async () => {
    const [glitched, plain] = await Promise.all([frameAt(36), frameAt(42)])
    const strip: Rect = { x: 160, y: 0, width: 960, height: 720 }
    const a = meanColor(glitched, strip)
    const b = meanColor(plain, strip)
    expect(Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)).toBeGreaterThan(6)
  })

  it('スピード線は周りだけを流してぼかし（上端で赤が右へにじむ）、真ん中は鮮明のまま', async () => {
    const [streaked, plain] = await Promise.all([frameAt(54), frameAt(7)])
    // 筋（白）は赤・緑・青を同じだけ足す。赤だけ緑より増えたら、それはぼかしで赤が流れてきた分。
    const redBleed = (frame: Frame, rect: Rect): number => meanColor(frame, rect).r - meanColor(frame, rect).g
    expect(redBleed(plain, RIGHT_OF_EDGE_TOP)).toBeLessThan(10)
    expect(redBleed(streaked, RIGHT_OF_EDGE_TOP)).toBeGreaterThan(25)
    expect(redBleed(streaked, RIGHT_OF_EDGE_MIDDLE)).toBeLessThan(10)
  })
})
