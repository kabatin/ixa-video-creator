import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { probeMedia } from '../probe.js'
import {
  RENDER_UPSCALE_CRF,
  containScale,
  needsRenderUpscale,
  renderUpscaleArgs,
  upscaleForRender,
} from '../render-upscale.js'
import { createTempDir, makeTestVideo, removeTempDir } from './fixtures.js'

/**
 * 書き出しの直前の拡大（ADR-0045）。
 * **拡大が要るのは枠より小さい素材だけ。** いまの素材（1920x1080）は触らない。
 */
const FRAME = { width: 1920, height: 1080 }

describe('拡大が要るか', () => {
  it.each([
    ['ネイティブの本番（1344x756）', 1344, 756, true],
    ['ネイティブの下書き（832x468）', 832, 468, true],
    ['いまの素材（1920x1080）', 1920, 1080, false],
    ['大きい素材（3840x2160。縮小は Chrome に任せる）', 3840, 2160, false],
    ['16px 揃えの 1920x1088', 1920, 1088, false],
  ])('%s → %s', (_label, width, height, expected) => {
    expect(needsRenderUpscale({ width, height }, FRAME)).toBe(expected)
  })

  it('倍率は contain（縦横の小さいほう）', () => {
    expect(containScale({ width: 1344, height: 756 }, FRAME)).toBeCloseTo(1.428571, 5)
    expect(containScale({ width: 1440, height: 1080 }, FRAME)).toBe(1)
  })
})

describe('ffmpeg の引数', () => {
  const args = renderUpscaleArgs('in.mp4', 'out.mp4', FRAME).join(' ')

  it('Lanczos で拡大する（Chrome の bilinear に任せない）', () => {
    expect(args).toContain('flags=lanczos')
  })

  it('比を保って枠の内側へ収める（持ち込んだ 4:3 を歪めない）', () => {
    expect(args).toContain('force_original_aspect_ratio=decrease')
  })

  it('中間は CRF 16（実測で決めた値）', () => {
    expect(RENDER_UPSCALE_CRF).toBe(16)
    expect(args).toContain('-crf 16')
  })
})

describe('upscaleForRender（実 ffmpeg）', () => {
  const FFMPEG_TIMEOUT_MS = 120_000
  let tempDir = ''
  let native = ''
  let fourThree = ''

  beforeAll(async () => {
    tempDir = await createTempDir()
    native = await makeTestVideo(join(tempDir, 'native.mp4'), {
      width: 1344,
      height: 756,
      fps: 24,
      durationSec: 1,
      withAudio: false,
    })
    fourThree = await makeTestVideo(join(tempDir, 'four-three.mp4'), {
      width: 640,
      height: 480,
      fps: 24,
      durationSec: 1,
      withAudio: true,
    })
  }, FFMPEG_TIMEOUT_MS)

  afterAll(async () => {
    await removeTempDir(tempDir)
  })

  it('ネイティブの本番は枠ちょうどへ拡大される', async () => {
    const out = join(tempDir, 'native-up.mp4')
    await upscaleForRender(native, out, FRAME)
    const probe = await probeMedia(out)
    expect({ width: probe.width, height: probe.height }).toEqual(FRAME)
  }, FFMPEG_TIMEOUT_MS)

  it('比の違う素材は歪めず、枠の内側に収まる（4:3 → 1440x1080）。音も残る', async () => {
    const out = join(tempDir, 'four-three-up.mp4')
    await upscaleForRender(fourThree, out, FRAME)
    const probe = await probeMedia(out)
    expect({ width: probe.width, height: probe.height }).toEqual({ width: 1440, height: 1080 })
    expect(probe.hasAudio).toBe(true)
  }, FFMPEG_TIMEOUT_MS)
})
