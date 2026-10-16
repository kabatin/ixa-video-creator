import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clampSeekSec, probeMedia, runFfmpeg, seekableDurationSec } from '@ixa/media'

/**
 * 絵を見るための切り出し（`view`）。動画からは N 枚、静止画からは 1 枚を、
 * 幅 `width` の JPEG に縮めて返す。応答を小さく保つため（MCP の 1 応答は文脈に乗る）。
 */

export type ExtractedFrame = {
  /** 動画のどこから抜いたか。静止画は null。 */
  readonly atSec: number | null
  readonly jpeg: Buffer
}

export type FrameExtractor = {
  readonly fromVideo: (path: string, count: number, width: number) => Promise<readonly ExtractedFrame[]>
  readonly fromImage: (path: string, width: number) => Promise<ExtractedFrame>
}

/** 切り出す位置。1 枚なら真ん中、2 枚以上なら頭から終わりまで等間隔（3 枚 = 頭・真ん中・終わり）。 */
export const framePositions = (durationSec: number, count: number): readonly number[] => {
  if (count <= 1) return [durationSec / 2]
  return Array.from({ length: count }, (_unused, i) => (durationSec * i) / (count - 1))
}

const JPEG_QUALITY = '4'

/** 縦は比を保って偶数に。元が小さければ大きくしない。 */
const scaleFilter = (width: number): readonly string[] => [
  '-vf',
  `scale='min(${String(width)},iw)':-2`,
]

const writeFrame = async (
  input: string,
  output: string,
  atSec: number | null,
  width: number,
): Promise<Buffer> => {
  await runFfmpeg(
    [
      '-y',
      ...(atSec !== null && atSec > 0 ? ['-ss', atSec.toFixed(6)] : []),
      '-i',
      input,
      '-frames:v',
      '1',
      ...scaleFilter(width),
      '-q:v',
      JPEG_QUALITY,
      output,
    ],
    { timeoutMs: 60_000 },
  )
  const jpeg = await readFile(output)
  if (jpeg.length === 0) throw new Error('フレームを書き出せませんでした（空のファイル）')
  return jpeg
}

const withTempDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), 'ixa-mcp-frames-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export const createFfmpegFrameExtractor = (): FrameExtractor => ({
  fromVideo: async (path, count, width) => {
    const probe = await probeMedia(path)
    const durationSec = seekableDurationSec(probe)
    if (durationSec === null) throw new Error('動画の尺を読めませんでした')
    const positions = framePositions(durationSec, count).map((at) =>
      clampSeekSec(at, durationSec, probe.fps),
    )
    // 1 枚ずつ順に（ffmpeg を並べて走らせると手元の機械を食う）。
    return withTempDir((dir) =>
      positions.reduce<Promise<readonly ExtractedFrame[]>>(
        async (done, atSec, index) => [
          ...(await done),
          {
            atSec: Math.round(atSec * 1000) / 1000,
            jpeg: await writeFrame(path, join(dir, `frame-${String(index)}.jpg`), atSec, width),
          },
        ],
        Promise.resolve([]),
      ),
    )
  },
  fromImage: (path, width) =>
    withTempDir(async (dir) => ({
      atSec: null,
      jpeg: await writeFrame(path, join(dir, 'image.jpg'), null, width),
    })),
})
