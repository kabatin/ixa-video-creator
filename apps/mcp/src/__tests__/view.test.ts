import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runFfmpeg } from '@ixa/media'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFfmpegFrameExtractor, framePositions, type FrameExtractor } from '../lib/frames.js'
import { viewTool } from '../tools/view.js'
import { createFakeApi, depsFor, takeRow, textOf, TOKEN, ulid } from './fake-api.js'

const JPEG_MAGIC = [0xff, 0xd8, 0xff]

describe('framePositions', () => {
  it('1 枚は真ん中、3 枚は頭・真ん中・終わり', () => {
    expect(framePositions(4, 1)).toEqual([2])
    expect(framePositions(4, 3)).toEqual([0, 2, 4])
  })
})

/** 本物の ffmpeg を呼ぶテストの待ち時間。 */
const REAL_FFMPEG_TIMEOUT_MS = 30_000

describe('ffmpeg での切り出し（本物の ffmpeg）', () => {
  const state = { dir: '' }
  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'ixa-mcp-test-'))
    // 2 秒・1280x720・24fps の小さな動画と、1600x900 の静止画を作る。
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24:duration=2', '-pix_fmt', 'yuv420p', join(state.dir, 'clip.mp4')])
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=1600x900:rate=1:duration=1', '-frames:v', '1', join(state.dir, 'still.png')])
  })
  afterAll(async () => {
    await rm(state.dir, { recursive: true, force: true })
  })

  it('動画から頭・真ん中・終わりの 3 枚を、幅を縮めた JPEG で返す', async () => {
    const frames = await createFfmpegFrameExtractor().fromVideo(join(state.dir, 'clip.mp4'), 3, 640)
    expect(frames).toHaveLength(3)
    expect(frames[0]?.atSec).toBe(0)
    expect(frames[1]?.atSec).toBe(1)
    // 終わりは最後のコマの手前に収める（そのままだとコマが出ない）。
    expect(frames[2]?.atSec).toBeGreaterThan(1.8)
    expect(frames[2]?.atSec).toBeLessThan(2)
    frames.forEach((f) => expect([...f.jpeg.subarray(0, 3)]).toEqual(JPEG_MAGIC))
    // 縮めたことを確かめる: 書き出して ffprobe の代わりに ffmpeg で幅を読む。
    const out = join(state.dir, 'f.jpg')
    await import('node:fs/promises').then((fs) => fs.writeFile(out, frames[1]?.jpeg ?? Buffer.alloc(0)))
    const { stderr } = await runFfmpeg(['-i', out, '-f', 'null', '-']).catch((e: { stderr: string }) => e)
    expect(stderr).toContain('640x360')
    // 本物の ffmpeg を 4 回呼ぶ。CI の遅い機械では既定の 5 秒を超えて落ちた（2026-10-17）。
  }, REAL_FFMPEG_TIMEOUT_MS)

  it('静止画は 1 枚、元より大きくはしない', async () => {
    const frame = await createFfmpegFrameExtractor().fromImage(join(state.dir, 'still.png'), 4000)
    expect(frame.atSec).toBeNull()
    const out = join(state.dir, 's.jpg')
    await import('node:fs/promises').then((fs) => fs.writeFile(out, frame.jpeg))
    const { stderr } = await runFfmpeg(['-i', out, '-f', 'null', '-'])
    expect(stderr).toContain('1600x900')
    expect((await readFile(out)).length).toBeGreaterThan(0)
  })
})

const SHOT = ulid('SH1')
const TAKE = ulid('TK1')
const MEDIA = ulid('MD9')

const recordingExtractor = (): FrameExtractor & { readonly calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    fromVideo: (path, count, width) => {
      calls.push(`video ${path.endsWith('.mp4') ? 'mp4' : path} ${String(count)} ${String(width)}`)
      return Promise.resolve(
        Array.from({ length: count }, (_, i) => ({ atSec: i, jpeg: Buffer.from([0xff, 0xd8, 0xff, i]) })),
      )
    },
    fromImage: (_path, width) => {
      calls.push(`image ${String(width)}`)
      return Promise.resolve({ atSec: null, jpeg: Buffer.from([0xff, 0xd8, 0xff]) })
    },
  }
}

describe('view ツール', () => {
  const routes = [
    { method: 'GET', path: `/shots/${SHOT}/takes`, data: [{ ...takeRow(TAKE, null, null), mediaAssetId: MEDIA }] },
    { method: 'GET', path: `/media/${MEDIA}`, data: { id: MEDIA, kind: 'video', mimeType: 'video/mp4' } },
    { method: 'GET', path: `/media/${MEDIA}/url`, data: { url: '/files/clip.mp4?sig=SIGNED', expiresInSec: 600 } },
    { method: 'GET', path: '/files/clip.mp4', bytes: new Uint8Array([0, 0, 0, 1]) },
  ]

  it('Take の動画を取り出し、指定の枚数を image content で返す（URL・鍵は返さない）', async () => {
    const fake = createFakeApi(routes)
    const frames = recordingExtractor()
    const result = await viewTool.run({ shotId: SHOT, takeId: TAKE, frames: 2, width: 512 }, depsFor(fake, { frames }))
    expect(result.isError).toBeUndefined()
    expect(frames.calls).toEqual(['video mp4 2 512'])
    expect(result.content.filter((c) => c.type === 'image')).toHaveLength(2)
    expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' })
    const text = textOf(result)
    expect(JSON.parse(text)).toEqual({ shotId: SHOT, takeId: TAKE, kind: 'video', frames: ['0s', '1s'] })
    expect(JSON.stringify(result)).not.toContain('SIGNED')
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(fake.callsTo('GET', '/files/clip.mp4')[0]?.headers.authorization).toBeUndefined()
  })

  it('shotId だけなら最初のコマを 1 枚', async () => {
    const IMAGE = ulid('MDA')
    const fake = createFakeApi([
      { method: 'GET', path: `/shots/${SHOT}/start-frame`, data: { mediaAssetId: IMAGE, job: null } },
      { method: 'GET', path: `/media/${IMAGE}`, data: { id: IMAGE, kind: 'image', mimeType: 'image/png' } },
      { method: 'GET', path: `/media/${IMAGE}/url`, data: { url: '/files/a.png', expiresInSec: 600 } },
      { method: 'GET', path: '/files/a.png', bytes: new Uint8Array([1]) },
    ])
    const frames = recordingExtractor()
    const result = await viewTool.run({ shotId: SHOT }, depsFor(fake, { frames }))
    expect(frames.calls).toEqual(['image 768'])
    expect(result.content).toHaveLength(2)
  })

  it('最初のコマが無ければ描くよう促す', async () => {
    const fake = createFakeApi([{ method: 'GET', path: `/shots/${SHOT}/start-frame`, data: { mediaAssetId: null, job: null } }])
    const result = await viewTool.run({ shotId: SHOT }, depsFor(fake))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('draw_start_frames')
  })

  it('見る対象は 1 つだけ', async () => {
    const result = await viewTool.run({ shotId: SHOT, mediaAssetId: MEDIA }, depsFor(createFakeApi([])))
    expect(textOf(result)).toContain('どれか 1 つ')
  })
})
