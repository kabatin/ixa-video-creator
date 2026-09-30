import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FfmpegError } from '../ffmpeg-runner.js'
import { probeMedia } from '../probe.js'
import {
  clampSeekSec,
  createThumbnail,
  extractLastFrame,
  extractPosterFrames,
  thumbnailPositionSec,
} from '../thumbnail.js'
import { createTempDir, makeTestStill, makeTestVideo, removeTempDir } from './fixtures.js'

/**
 * フレームが 1 枚か数枚しかない素材の回帰テスト。
 *
 * 入力側の -ss が最後のフレームの開始時刻を越えると、ffmpeg は 1 枚も書き出さない。
 * しかも exit 0 で終わることがあり、取り込みパイプラインは後段で
 * `derivatives/thumb.jpg` が無い（ENOENT）として落ちていた。
 * JPEG（image2 デマルチプレクサ）は入力側の -ss を受けると 0 秒でも 1 枚も返さない。
 */

const FFMPEG_TIMEOUT_MS = 120_000

const expectNonEmptyFile = async (path: string): Promise<void> => {
  expect((await stat(path)).size).toBeGreaterThan(0)
}

describe('clampSeekSec', () => {
  it('最後のフレームより手前の位置はそのまま使う', () => {
    expect(clampSeekSec(1, 4, 30)).toBe(1)
  })

  it('1 フレームしかない素材（JPEG は 25fps で 0.04 秒に見える）では 0 秒になる', () => {
    expect(clampSeekSec(0.004, 0.04, 25)).toBe(0)
  })

  it('最後のフレームの開始時刻を越えない（丸めで越えないよう半フレームの余裕を持つ）', () => {
    // 30fps で 3 フレーム（0 / 0.033 / 0.067 秒）。0.083 秒はどのフレームの開始時刻より後ろ。
    const clamped = clampSeekSec(0.083, 0.1, 30)
    expect(clamped).toBeGreaterThan(1 / 30)
    expect(clamped).toBeLessThan(2 / 30)
  })

  it('fps が不明でも尺ちょうどは指さない', () => {
    expect(clampSeekSec(4, 4, null)).toBeLessThan(4)
    expect(clampSeekSec(4, 4, null)).toBeGreaterThan(3.9)
  })
})

describe('thumbnailPositionSec', () => {
  it('尺の 10% 地点を採る', () => {
    expect(thumbnailPositionSec({ durationSec: 10, fps: 30 })).toBeCloseTo(1, 6)
  })

  it('尺が取れない素材（PNG など）では 0 秒', () => {
    expect(thumbnailPositionSec({ durationSec: null, fps: 25 })).toBe(0)
  })

  it('1 フレームしかない素材では 0 秒', () => {
    expect(thumbnailPositionSec({ durationSec: 0.04, fps: 25 })).toBe(0)
  })
})

describe('静止画と数フレームしかない動画（実 ffmpeg）', () => {
  let tempDir = ''
  let jpegPath = ''
  let pngPath = ''
  /** 10fps・0.1 秒＝ 1 フレームだけの動画。 */
  let oneFramePath = ''
  /** 5fps・1 秒。最終フレームの開始時刻（0.8 秒）が「尺 − 0.1 秒」より手前にある。 */
  let lowFpsPath = ''

  beforeAll(async () => {
    tempDir = await createTempDir()
    const size = { width: 1280, height: 720 }
    jpegPath = await makeTestStill(join(tempDir, 'still.jpg'), size)
    pngPath = await makeTestStill(join(tempDir, 'still.png'), size)
    oneFramePath = await makeTestVideo(join(tempDir, 'one-frame.mp4'), {
      ...size,
      fps: 10,
      durationSec: 0.1,
      withAudio: false,
    })
    lowFpsPath = await makeTestVideo(join(tempDir, 'low-fps.mp4'), {
      ...size,
      fps: 5,
      durationSec: 1,
      withAudio: false,
    })
  }, FFMPEG_TIMEOUT_MS)

  afterAll(async () => {
    await removeTempDir(tempDir)
  })

  it.each([
    ['JPEG', '位置省略', () => jpegPath, undefined],
    ['JPEG', '0 秒指定（取り込みパイプラインの image 経路）', () => jpegPath, 0],
    ['PNG', '位置省略', () => pngPath, undefined],
    ['PNG', '0 秒指定', () => pngPath, 0],
  ] as const)(
    '%s の静止画から %s で幅 640 のサムネイルを作る',
    async (format, _label, sourcePath, atSec) => {
      const outputPath = join(tempDir, `thumb-${format}-${String(atSec)}.jpg`)
      await createThumbnail(sourcePath(), outputPath, atSec)

      const probe = await probeMedia(outputPath)
      expect(probe.width).toBe(640)
      expect(probe.height).toBe(360)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '1 フレームしかない動画でもサムネイルを作る',
    async () => {
      const outputPath = join(tempDir, 'thumb-one-frame.jpg')
      await createThumbnail(oneFramePath, outputPath)

      await expectNonEmptyFile(outputPath)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    '1 フレームしかない動画でも指定枚数のポスターフレームを作る',
    async () => {
      const outputDir = join(tempDir, 'posters-one-frame')
      const paths = await extractPosterFrames(oneFramePath, outputDir, 5, 0.1, 10)

      expect(paths).toHaveLength(5)
      expect(await readdir(outputDir)).toHaveLength(5)
      for (const path of paths) await expectNonEmptyFile(path)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    'フレーム間隔が 0.1 秒より長い動画でも最終フレームを作る',
    async () => {
      const outputPath = join(tempDir, 'last-frame-low-fps.jpg')
      await extractLastFrame(lowFpsPath, outputPath, 1, 5)

      await expectNonEmptyFile(outputPath)
    },
    FFMPEG_TIMEOUT_MS,
  )

  it(
    'ffmpeg が 1 枚も書き出さなければ FfmpegError にする（後段の ENOENT にしない）',
    async () => {
      // JPEG の 1 秒地点にフレームは無い。ffmpeg はこの場合も exit 0 で終わる。
      const outputPath = join(tempDir, 'thumb-out-of-range.jpg')
      await expect(createThumbnail(jpegPath, outputPath, 1)).rejects.toBeInstanceOf(FfmpegError)
    },
    FFMPEG_TIMEOUT_MS,
  )
})
