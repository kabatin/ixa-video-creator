import type { TimelineDocument } from '@ixa/domain'
import { probeMedia, runFfmpeg } from '@ixa/media'
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
 * **テロップが本当に絵になっているかをピクセルで確かめる。**
 *
 * `text-clip.test.tsx` が見ているのは「出力 HTML に文字が入っているか」で、
 * 「MP4 のピクセルに文字が出ているか」ではない（tasks/lessons.md L-011）。
 * フォントが無ければ HTML には文字があるのに画は空になりうるため、
 * ここだけが**日本語が実際に描かれたこと**を確かめる。
 *
 * Chrome の起動とエンコードで分単位かかるので、判定ロジックのテストとは別ファイルにする。
 * レンダリングは 1 回だけで、テンプレート 2 種を時間で分けて 1 本に載せる。
 */

const RENDER_TIMEOUT_MS = 10 * 60 * 1000
const SETUP_TIMEOUT_MS = 3 * 60 * 1000

const FPS = 12
const TOTAL_SEC = 3
const SOURCE = { width: 320, height: 240 } as const
/** preview_720p のキャンバス。320x240 は 960x720 になり、左右に黒帯が出る。 */
const CANVAS = { width: 1280, height: 720 } as const

/** 実際の制作で入る日本語。ASCII だけで確かめると、日本語が出ない不具合を見逃す。 */
const JP_TEXT = 'iXA カップ 開幕'

/** 強調を見るための 10 字。字ごとに時刻を振り、途中まで塗られている絵を作る。 */
const HIGHLIGHT_TEXT = 'あいうえおかきくけこ'

/** 画面中央。`plain` の文字が来る場所。 */
const CENTER_BAND: Rect = { x: 300, y: 300, width: 680, height: 120 }
/** 下寄せの帯。`lower_third` の文字が来る場所。 */
const LOWER_BAND: Rect = { x: 300, y: 565, width: 500, height: 80 }
/** 帯の中で文字が来ない右側。帯そのものが敷かれたかを見る。 */
const BAND_ONLY: Rect = { x: 820, y: 575, width: 180, height: 60 }
/**
 * 見た目を上書きしたテロップ（左上・画面の高さの 10%・緑）の文字が来る場所（ADR-0028）。
 * 映像の枠は x=160〜1120。左上の定位置は枠の端から少し内側。
 */
const TOP_LEFT_BAND: Rect = { x: 215, y: 62, width: 300, height: 70 }
/**
 * 話している字を強調するテロップ（ADR-0038）の行。**字の途中で色が変わる**ので、
 * 行の全体（左の塗った字と、右のまだ白い字）が入る幅で見る。
 */
const NARRATION_BAND: Rect = { x: 200, y: 60, width: 900, height: 80 }
/** テロップが一切来ない、Shot のベタ塗りだけが写る場所。 */
const SHOT_PATCH: Rect = { x: 200, y: 60, width: 200, height: 80 }

const atFrame = (frame: number): number => Math.max(0, (frame - 0.5) / FPS)

let workDir = ''
let outputPath = ''
let server: MediaServer | null = null

const sourcePath = (name: string): string => join(workDir, `${name}.mp4`)

const makeSolidVideo = async (name: string, color: string): Promise<void> => {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${color}:size=${SOURCE.width}x${SOURCE.height}:rate=${FPS}:duration=${TOTAL_SEC}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    sourcePath(name),
  ])
}

/**
 * ```
 * 0            1.5          3 (秒)
 * |赤 ---------------------|
 * TEXT  0.5-1.25 plain
 * TEXT  2.0-2.75 lower_third
 * ```
 * 赤一色の上に載せるので、白い文字とグレーの帯はピクセルの値だけで判別できる。
 */
const buildDocument = (media: MediaServer): TimelineDocument =>
  makeDocument({
    fps: FPS,
    resolution: { ...SOURCE },
    durationSec: TOTAL_SEC,
    video1: [{ ...makeVideo1Shot(1, 0, TOTAL_SEC), mediaUrl: media.urlFor(sourcePath('red')) }],
    transitions: [],
    clips: [
      makeClip(1, 'TEXT', 0.5, 0.75, 0, {
        type: 'text',
        templateKey: 'plain',
        params: { text: JP_TEXT },
      }),
      makeClip(2, 'TEXT', 2, 0.75, 0, {
        type: 'text',
        templateKey: 'lower_third',
        params: { text: JP_TEXT },
      }),
      // 話している字の強調（ADR-0038）。2.25 秒の時点で、頭の 6 字が塗られて残り 4 字は白い。
      makeClip(4, 'TEXT', 2, 0.75, 0, {
        type: 'text',
        templateKey: 'plain',
        params: {
          text: HIGHLIGHT_TEXT,
          style: { anchor: 'top-left', align: 'left', size: 0.1 },
          highlight: {
            color: '#0000FF',
            chars: [...HIGHLIGHT_TEXT].map((char, index) => ({ char, startSec: index * 0.05, endSec: (index + 1) * 0.05 })),
          },
        },
      }),
      makeClip(3, 'TEXT', 1.25, 0.75, 0, {
        type: 'text',
        templateKey: 'plain',
        params: {
          text: JP_TEXT,
          style: { color: '#00FF00', anchor: 'top-left', align: 'left', size: 0.1, fadeInSec: 0.5 },
        },
      }),
    ],
    audio: [],
  })

const frameAt = (index: number): Promise<Frame> => {
  if (outputPath === '') throw new Error('レンダリングが完了していないためフレームを取り出せません')
  return extractFrame(outputPath, atFrame(index), workDir)
}

const isWhitish = (pixel: { r: number; g: number; b: number }): boolean =>
  pixel.r > 150 && pixel.g > 150 && pixel.b > 150

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ixa-text-clip-pixels-'))
  await makeSolidVideo('red', '0xff0000')
  server = await startMediaServer(workDir)
}, SETUP_TIMEOUT_MS)

afterAll(async () => {
  clearBundleCache()
  if (server !== null) await server.close()
  if (workDir !== '') await rm(workDir, { recursive: true, force: true })
})

describe('テロップのピクセル検証', () => {
  it(
    'テロップを載せた 1 本を書き出す',
    async () => {
      if (server === null) throw new Error('メディアサーバが起動していません')
      const renderer = createRemotionRenderer({ outputDir: join(workDir, 'out') })
      const result = await renderer.render(buildDocument(server), 'preview_720p', () => undefined)

      outputPath = result.storageKey
      expect(result.bytes).toBeGreaterThan(0)

      const probe = await probeMedia(outputPath)
      expect({ width: probe.width, height: probe.height }).toEqual(CANVAS)
    },
    RENDER_TIMEOUT_MS,
  )

  it('plain は画面の中央に白い文字を出す', async () => {
    const [withText, withoutText] = await Promise.all([frameAt(9), frameAt(2)])
    expect(countPixels(withText, CENTER_BAND, isWhitish)).toBeGreaterThan(200)
    expect(countPixels(withoutText, CENTER_BAND, isWhitish)).toBeLessThan(20)
  })

  it('plain は下寄せの帯を敷かない（lower_third と見た目が違う）', async () => {
    const frame = await frameAt(9)
    expect(countPixels(frame, LOWER_BAND, isWhitish)).toBeLessThan(20)
    expect(meanColor(frame, BAND_ONLY).r).toBeGreaterThan(180)
  })

  it('lower_third は下寄せの帯に白い文字を出す', async () => {
    const [withText, withoutText] = await Promise.all([frameAt(27), frameAt(2)])
    expect(countPixels(withText, LOWER_BAND, isWhitish)).toBeGreaterThan(200)
    expect(countPixels(withoutText, LOWER_BAND, isWhitish)).toBeLessThan(20)
  })

  it('lower_third は文字の下に暗い帯を敷く（赤の上で暗くなる）', async () => {
    const [withBand, withoutBand] = await Promise.all([frameAt(27), frameAt(2)])
    expect(meanColor(withBand, BAND_ONLY).r).toBeLessThan(180)
    expect(meanColor(withoutBand, BAND_ONLY).r).toBeGreaterThan(180)
  })

  it('lower_third は画面の中央に文字を出さない（plain と見た目が違う）', async () => {
    expect(countPixels(await frameAt(27), CENTER_BAND, isWhitish)).toBeLessThan(20)
  })

  it('テロップの区間を外れると文字は消える', async () => {
    const after = await frameAt(21)
    expect(countPixels(after, CENTER_BAND, isWhitish)).toBeLessThan(20)
    expect(countPixels(after, LOWER_BAND, isWhitish)).toBeLessThan(20)
  })

  const isGreen = (pixel: { r: number; g: number; b: number }): boolean =>
    pixel.g > 150 && pixel.r < 110 && pixel.b < 110

  it('見た目を上書きしたテロップは、指定の色で左上に出る（ADR-0028）', async () => {
    const frame = await frameAt(23)
    expect(countPixels(frame, TOP_LEFT_BAND, isGreen)).toBeGreaterThan(200)
    expect(countPixels(frame, CENTER_BAND, isGreen)).toBeLessThan(20)
  })

  it('フェードインの頭ではまだ見えない（0.5 秒かけて出てくる）', async () => {
    expect(countPixels(await frameAt(16), TOP_LEFT_BAND, isGreen)).toBeLessThan(20)
  })

  const isBlue = (pixel: { r: number; g: number; b: number }): boolean =>
    pixel.b > 150 && pixel.r < 110 && pixel.g < 110

  /** ADR-0038。**ここだけが「話している字が実際に塗られている」ことを画で確かめる。** */
  it('話している字は強調の色で塗られ、まだの字は白いまま（同じ行に両方が出る）', async () => {
    const frame = await frameAt(27)

    expect(countPixels(frame, NARRATION_BAND, isBlue)).toBeGreaterThan(100)
    expect(countPixels(frame, NARRATION_BAND, isWhitish)).toBeGreaterThan(100)
  })

  it('強調のテロップが出る前は、その行に色も文字も無い', async () => {
    const frame = await frameAt(21)

    expect(countPixels(frame, NARRATION_BAND, isBlue)).toBeLessThan(20)
    expect(countPixels(frame, NARRATION_BAND, isWhitish)).toBeLessThan(20)
  })

  it('テロップは Shot の絵を塗りつぶさない', async () => {
    const mean = meanColor(await frameAt(9), SHOT_PATCH)
    expect(mean.r).toBeGreaterThan(150)
    expect(mean.g).toBeLessThan(80)
  })
})
