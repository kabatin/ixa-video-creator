import type { TimelineDocument } from '@ixa/domain'
import { probeMedia, runFfmpeg } from '@ixa/media'
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
 * **実 Remotion で 1 本書き出し、出てきた MP4 のピクセルを見る結合テスト。**
 *
 * `plan.test.ts` が確かめているのは「計画がどうなるか」であって
 * 「画にどう出るか」ではない（tasks/lessons.md L-011）。ここだけが後者を確かめる。
 * Chrome の起動とエンコードで分単位かかるため、判定ロジックのテストとは**別ファイルに分けている**。
 *
 * レンダリングは 1 回だけ行い、1 本のタイムラインに確かめたいものを全部載せる。
 * Shot をベタ塗りの原色にしてあるのは、重なり・混色・縮退をピクセルの値だけで判別するため。
 */

const RENDER_TIMEOUT_MS = 10 * 60 * 1000
const SETUP_TIMEOUT_MS = 3 * 60 * 1000

const FPS = 12
const SHOT_SEC = 2
/** ディゾルブの尻は Shot の尺を超えて素材を要求する。素材に「のりしろ」を持たせる。 */
const SOURCE_SEC = 3
const TOTAL_SEC = SHOT_SEC * 4
const SOURCE = { width: 320, height: 240 } as const

/** preview_720p のキャンバス。320x240 は 960x720 にレターボックスされ、左右に黒帯が出る。 */
const CANVAS = { width: 1280, height: 720 } as const

const COLORS = {
  red: '0xff0000',
  blue: '0x0000ff',
  green: '0x00ff00',
  white: '0xffffff',
} as const

/** 中央のテキスト描画を避けた、Shot のベタ塗りだけが写る場所。 */
const SHOT_PATCH: Rect = { x: 220, y: 580, width: 160, height: 100 }
/** 画面中央。テンプレートのプレースホルダ文字列が描かれる帯。 */
const TEXT_BAND: Rect = { x: 300, y: 320, width: 680, height: 90 }
/** unresolved プレースホルダの赤い枠。映像の外（黒帯）なので Shot の色と混ざらない。 */
const LEFT_BORDER: Rect = { x: 0, y: 280, width: 4, height: 160 }

/**
 * フレーム番号 n を狙うためのシーク時刻。
 *
 * `-ss` を `-i` の後ろに置いた出力シークは **ts がこの値以上の最初のフレーム**を返す。
 * n/FPS ちょうどを渡すと丸め次第で n+1 が返るため、半フレーム手前を狙う。
 */
const atFrame = (frame: number): number => Math.max(0, (frame - 0.5) / FPS)

let workDir = ''
let outputPath = ''
let server: MediaServer | null = null

const sourcePath = (name: string): string => join(workDir, `${name}.mp4`)

const makeSolidVideo = async (name: string, color: string): Promise<void> => {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${color}:size=${SOURCE.width}x${SOURCE.height}:rate=${FPS}:duration=${SOURCE_SEC}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    sourcePath(name),
  ])
}

/**
 * 1 本で全部を見るためのタイムライン。
 *
 * ```
 * 0    2      4      6      8 (秒)
 * |赤  |青    |緑    |白    |
 *      ^dissolve    ^dip_to_black
 *             ^wipe（未実装。cut に縮退するはず）
 * TEXT             0.5-1.5
 * VFX(mg)          2.5-3.5
 * VIDEO2(unres.)   4.5-5.5
 * ```
 */
const buildDocument = (media: MediaServer): TimelineDocument => {
  const names = ['red', 'blue', 'green', 'white'] as const
  return makeDocument({
    fps: FPS,
    resolution: { ...SOURCE },
    durationSec: TOTAL_SEC,
    video1: names.map((name, index) => ({
      ...makeVideo1Shot(index + 1, index * SHOT_SEC, SHOT_SEC),
      mediaUrl: media.urlFor(sourcePath(name)),
    })),
    transitions: [
      makeTransition(1, shotId(1), shotId(2), 'dissolve', 0.5),
      makeTransition(2, shotId(2), shotId(3), 'wipe', 0.5),
      makeTransition(3, shotId(3), shotId(4), 'dip_to_black', 0.5),
    ],
    clips: [
      makeClip(1, 'TEXT', 0.5, 1, 0, {
        type: 'text',
        templateKey: 'no_such_text_template',
        params: { label: 'iXA CUP' },
      }),
      makeClip(2, 'VFX', 2.5, 1, 0, {
        type: 'motion_graphics',
        templateKey: 'no_such_mg_template',
        params: {},
      }),
      makeClip(3, 'VIDEO2', 4.5, 1, 0, {
        type: 'unresolved',
        reason: 'MediaAsset が見つかりません',
      }),
    ],
    audio: [],
  })
}

const frameAt = (index: number): Promise<Frame> => {
  if (outputPath === '') throw new Error('レンダリングが完了していないためフレームを取り出せません')
  return extractFrame(outputPath, atFrame(index), workDir)
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ixa-remotion-render-'))
  await Promise.all(Object.entries(COLORS).map(([name, color]) => makeSolidVideo(name, color)))
  server = await startMediaServer(workDir)
}, SETUP_TIMEOUT_MS)

afterAll(async () => {
  clearBundleCache()
  if (server !== null) await server.close()
  if (workDir !== '') await rm(workDir, { recursive: true, force: true })
})

describe('Remotion レンダリング結果のピクセル検証', () => {
  it(
    'preview_720p を 1 本書き出す',
    async () => {
      if (server === null) throw new Error('メディアサーバが起動していません')
      const renderer = createRemotionRenderer({ outputDir: join(workDir, 'out') })
      const result = await renderer.render(buildDocument(server), 'preview_720p', () => undefined)

      outputPath = result.storageKey
      expect(result.bytes).toBeGreaterThan(0)
      expect(Math.abs(result.durationSec - TOTAL_SEC)).toBeLessThanOrEqual(1 / FPS)

      // 以降の座標はすべてプリセットのキャンバスを前提にしている。
      const probe = await probeMedia(outputPath)
      expect({ width: probe.width, height: probe.height }).toEqual(CANVAS)
    },
    RENDER_TIMEOUT_MS,
  )

  describe('VIDEO1 の Shot', () => {
    it('レターボックスの内側に Shot の色が出る', async () => {
      const mean = meanColor(await frameAt(2), SHOT_PATCH)
      expect(mean.r).toBeGreaterThan(150)
      expect(mean.g).toBeLessThan(80)
      expect(mean.b).toBeLessThan(80)
    })

    it('レターボックスの黒帯は黒のまま', async () => {
      const mean = meanColor(await frameAt(2), { x: 0, y: 280, width: 100, height: 160 })
      expect(mean.r).toBeLessThan(40)
      expect(mean.g).toBeLessThan(40)
      expect(mean.b).toBeLessThan(40)
    })
  })

  describe('dissolve は画に出る', () => {
    it('境界の後ろで前後の Shot が混ざる（赤と青が同時に乗る）', async () => {
      const mean = meanColor(await frameAt(27), SHOT_PATCH)
      expect(mean.r).toBeGreaterThan(50)
      expect(mean.b).toBeGreaterThan(50)
      expect(mean.g).toBeLessThan(80)
    })

    it('ディゾルブは指定の尺ちょうどで終わる（フレーム単位でずれない）', async () => {
      // Shot1 は本体 24 フレーム + ディゾルブ 6 フレームで frame 29 が最後。
      // frame 30 で赤が完全に消えていなければ、尺の計算が 1 フレームずれている。
      const last = meanColor(await frameAt(29), SHOT_PATCH)
      const gone = meanColor(await frameAt(30), SHOT_PATCH)
      expect(last.r).toBeGreaterThan(20)
      expect(gone.r).toBeLessThan(20)
    })

    it('前の Shot が時間とともに薄くなる（1 枚だけの偶然ではない）', async () => {
      const early = meanColor(await frameAt(25), SHOT_PATCH)
      const middle = meanColor(await frameAt(27), SHOT_PATCH)
      const late = meanColor(await frameAt(29), SHOT_PATCH)
      expect(early.r).toBeGreaterThan(middle.r)
      expect(middle.r).toBeGreaterThan(late.r)
      expect(early.b).toBeLessThan(late.b)
    })
  })

  describe('dip_to_black は画に出る', () => {
    it('dip の直前はまだ緑', async () => {
      const mean = meanColor(await frameAt(68), SHOT_PATCH)
      expect(mean.g).toBeGreaterThan(150)
    })

    it('境界のフレームは黒に落ちる', async () => {
      const mean = meanColor(await frameAt(72), SHOT_PATCH)
      expect(mean.r).toBeLessThan(40)
      expect(mean.g).toBeLessThan(40)
      expect(mean.b).toBeLessThan(40)
    })

    it('dip を抜けると次の Shot が出る', async () => {
      const mean = meanColor(await frameAt(78), SHOT_PATCH)
      expect(mean.r).toBeGreaterThan(180)
      expect(mean.g).toBeGreaterThan(180)
      expect(mean.b).toBeGreaterThan(180)
    })
  })

  describe('未実装の wipe は cut に化ける（画で確かめる）', () => {
    it('境界の後ろで前の Shot（青）の痕跡が残らない', async () => {
      const mean = meanColor(await frameAt(51), SHOT_PATCH)
      expect(mean.g).toBeGreaterThan(150)
      expect(mean.b).toBeLessThan(60)
      expect(mean.r).toBeLessThan(60)
    })

    it('境界の前後で色が 1 フレームで入れ替わる（混ざらない）', async () => {
      const before = meanColor(await frameAt(47), SHOT_PATCH)
      const after = meanColor(await frameAt(48), SHOT_PATCH)
      expect(before.b).toBeGreaterThan(150)
      expect(before.g).toBeLessThan(60)
      expect(after.g).toBeGreaterThan(150)
      expect(after.b).toBeLessThan(60)
    })
  })

  describe('存在しないテンプレートのクリップは無言で消えない', () => {
    const isWhitish = (pixel: { r: number; g: number; b: number }): boolean =>
      pixel.r > 150 && pixel.g > 150 && pixel.b > 150

    it('text クリップは赤い Shot の上に白い文字として出る', async () => {
      const [withText, withoutText] = await Promise.all([frameAt(8), frameAt(2)])
      expect(countPixels(withText, TEXT_BAND, isWhitish)).toBeGreaterThan(200)
      expect(countPixels(withoutText, TEXT_BAND, isWhitish)).toBeLessThan(20)
    })

    it('motion_graphics クリップは青い Shot の上に白い文字として出る', async () => {
      const [withMg, withoutMg] = await Promise.all([frameAt(36), frameAt(44)])
      expect(countPixels(withMg, TEXT_BAND, isWhitish)).toBeGreaterThan(200)
      expect(countPixels(withoutMg, TEXT_BAND, isWhitish)).toBeLessThan(20)
    })
  })

  describe('unresolved クリップは赤枠で出る', () => {
    it('クリップの区間だけ画面の縁が赤くなる', async () => {
      const [during, after] = await Promise.all([frameAt(60), frameAt(90)])
      const inside = meanColor(during, LEFT_BORDER)
      const outside = meanColor(after, LEFT_BORDER)
      expect(inside.r).toBeGreaterThan(120)
      expect(outside.r).toBeLessThan(60)
    })
  })
})
