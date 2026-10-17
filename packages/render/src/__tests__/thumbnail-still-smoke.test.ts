import { MediaAssetId, THUMBNAIL_MAX_BYTES, ThumbnailSpec } from '@ixa/domain'
import { runFfmpeg } from '@ixa/media'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearBundleCache } from '../bundle-cache.js'
import { renderThumbnailStill } from '../thumbnail-renderer.js'
import { extractFrame, meanColor, type Rect } from './frame-probe.js'
import { makeDocument, makeVideo1Shot } from './fixtures.js'
import { startMediaServer, type MediaServer } from './media-server.js'

/**
 * **実 Remotion の renderStill でサムネイルを描き、JPEG のピクセルを見る**（ADR-0051）。
 *
 * バンドルと Chrome の起動で数十秒かかるので、`RUN_RENDER_SMOKE=1` のときだけ走らせる（CI では飛ばす）。
 * 確かめるのは「止めたコマが本当にそのコマか」「画像の背景が出るか」「2 MB 未満か」。
 */

const RUN = process.env.RUN_RENDER_SMOKE === '1'
const TIMEOUT_MS = 5 * 60 * 1000
const FPS = 12
/** 右側の、題名と暗がりから外れた場所。背景の色だけが写る。 */
const RIGHT_PATCH: Rect = { x: 1000, y: 300, width: 160, height: 120 }

let workDir = ''
let server: MediaServer | null = null

const solidVideo = async (name: string, color: string): Promise<void> => {
  await runFfmpeg([
    '-y', '-f', 'lavfi', '-i', `color=c=${color}:size=320x240:rate=${String(FPS)}:duration=3`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(workDir, `${name}.mp4`),
  ])
}

describe.skipIf(!RUN)('サムネイルの renderStill（実 Remotion）', () => {
  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'ixa-thumbnail-smoke-'))
    await Promise.all([solidVideo('red', '0xff0000'), solidVideo('blue', '0x0000ff')])
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x00ff00:size=640x480', '-frames:v', '1', join(workDir, 'green.png')])
    server = await startMediaServer(workDir)
  }, TIMEOUT_MS)

  afterAll(async () => {
    clearBundleCache()
    if (server !== null) await server.close()
    // 目で見たいときは THUMBNAIL_SMOKE_KEEP=1 で残す（場所はログに出る）。
    if (process.env.THUMBNAIL_SMOKE_KEEP === '1') {
      process.stderr.write(`サムネイルの確かめの出力: ${workDir}\n`)
      return
    }
    if (workDir !== '') await rm(workDir, { recursive: true, force: true })
  })

  it('タイムラインの 3 秒のコマ（青の Shot）に止めて描き、2 MB 未満', async () => {
    const media = server as MediaServer
    const doc = makeDocument({
      fps: FPS,
      resolution: { width: 320, height: 240 },
      durationSec: 4,
      video1: [
        { ...makeVideo1Shot(1, 0, 2), mediaUrl: media.urlFor(join(workDir, 'red.mp4')) },
        { ...makeVideo1Shot(2, 2, 2), mediaUrl: media.urlFor(join(workDir, 'blue.mp4')) },
      ],
    })
    const spec = ThumbnailSpec.parse({ background: { kind: 'timeline_frame', atSec: 3 }, title: '新曲 MV', subtitle: '2026 秋' })
    const result = await renderThumbnailStill({ props: { spec, source: { kind: 'timeline_frame', doc } }, outputDir: workDir })
    expect(result.bytes).toBeLessThan(THUMBNAIL_MAX_BYTES)
    expect(result.jpegQuality).toBe(90)
    const frame = await extractFrame(result.path, 0, workDir)
    expect(frame.width).toBe(1280)
    expect(frame.height).toBe(720)
    const color = meanColor(frame, RIGHT_PATCH)
    expect(color.b).toBeGreaterThan(200)
    expect(color.r).toBeLessThan(60)
  }, TIMEOUT_MS)

  it('画像の背景を覆って描く', async () => {
    const media = server as MediaServer
    const spec = ThumbnailSpec.parse({
      background: { kind: 'image', mediaAssetId: MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW') },
      title: 'キーアート',
      layout: 'bottom',
    })
    const result = await renderThumbnailStill({
      props: { spec, source: { kind: 'image', url: media.urlFor(join(workDir, 'green.png')) } },
      outputDir: workDir,
    })
    const color = meanColor(await extractFrame(result.path, 0, workDir), { x: 1000, y: 100, width: 160, height: 120 })
    expect(color.g).toBeGreaterThan(200)
    expect(color.r).toBeLessThan(60)
  }, TIMEOUT_MS)
})
