import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { FfmpegError, runFfmpeg, type RunOptions } from './ffmpeg-runner.js'
import { probeMedia } from './probe.js'

/** サムネイルの既定位置。冒頭は黒フレームやフェードインになりがちなので尺の 10% を採る。 */
const DEFAULT_THUMBNAIL_POSITION_RATIO = 0.1
const THUMBNAIL_WIDTH = 640
const JPEG_QUALITY = '3'

/**
 * シーク位置の上限を「最後のフレームの開始時刻の半フレーム手前」にする。
 * ちょうど開始時刻を狙うと、秒の丸め次第で越えてしまうため。
 */
const LAST_FRAME_MARGIN_FRAMES = 1.5
/** fps が取れない素材で 1 フレームの長さを見積もるための値。映像で一般的な最小のフレームレート。 */
const FALLBACK_FPS = 24

const PositionSec = z.number().finite().nonnegative()
const PosterCount = z.number().int().positive()
const DurationSec = z.number().finite().positive()

/** 小数点以下 6 桁。ffmpeg の -ss は文字列で受けるため、指数表記にならないよう固定する。 */
const formatSeconds = (seconds: number): string => seconds.toFixed(6)

/** `poster-000.jpg` のように 3 桁ゼロ埋めする。連番のまま辞書順で並ぶようにするため。 */
export const posterFrameFileName = (index: number): string =>
  `poster-${String(index).padStart(3, '0')}.jpg`

/**
 * ポスターフレームを抜く秒数を等間隔で決める純粋関数。
 * 冒頭と末尾は黒フレーム / 不完全フレームになりやすいので避け、内側だけを使う。
 */
export const posterFramePositions = (durationSec: number, count: number): readonly number[] => {
  const duration = DurationSec.parse(durationSec)
  const total = PosterCount.parse(count)
  return Array.from({ length: total }, (_unused, index) => (duration * (index + 1)) / (total + 1))
}

/**
 * 入力側の -ss で狙う位置を、実際にフレームがある範囲へ収める純粋関数。
 *
 * -ss は指定秒より前に始まるフレームを捨てるので、最後のフレームの開始時刻より後ろを指すと
 * 1 枚も出てこない。フレームが数枚しかない動画や fps の低い動画ではこれが起きる。
 * 1 フレームしかない素材（JPEG は ffprobe 上「25fps で 0.04 秒」に見える）では 0 秒になる。
 */
export const clampSeekSec = (
  positionSec: number,
  durationSec: number,
  fps: number | null,
): number => {
  const latestSec = durationSec - LAST_FRAME_MARGIN_FRAMES / (fps ?? FALLBACK_FPS)
  return Math.max(0, Math.min(positionSec, latestSec))
}

/** サムネイルを切り出す位置。尺の 10% 地点。尺が取れない素材（PNG など）では 0 秒。 */
export const thumbnailPositionSec = (source: {
  readonly durationSec: number | null
  readonly fps: number | null
}): number =>
  source.durationSec === null
    ? 0
    : clampSeekSec(
        source.durationSec * DEFAULT_THUMBNAIL_POSITION_RATIO,
        source.durationSec,
        source.fps,
      )

/** ENOENT だけを「無い」とみなす。権限エラーなどは握り潰さずそのまま投げる。 */
const isNonEmptyFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).size > 0
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

/**
 * 1 フレームだけ JPEG に書き出す共通処理。
 *
 * - 0 秒なら -ss を付けない。JPEG（image2 デマルチプレクサ）は入力側の -ss を受けると
 *   0 秒でも 1 フレームも返さないため
 * - ffmpeg はフレームが 1 枚も出なくても exit 0 で終わることがある。
 *   後段で ENOENT として落ちると原因が分からないので、ここで書き出せたかを確かめる
 */
const writeSingleFrame = async (
  inputPath: string,
  outputPath: string,
  positionSec: number,
  filterArgs: readonly string[],
  runOptions?: RunOptions,
): Promise<void> => {
  const args = [
    '-y',
    // -i より前の -ss は高速シーク。1 枚取り出すだけなので精度より速度を優先する。
    ...(positionSec > 0 ? ['-ss', formatSeconds(positionSec)] : []),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    ...filterArgs,
    '-q:v',
    JPEG_QUALITY,
    outputPath,
  ]

  // 前回の残骸を「今回書けた」と取り違えないよう先に消す。
  await rm(outputPath, { force: true })
  const { stderr } = await runFfmpeg(args, runOptions)

  if (!(await isNonEmptyFile(outputPath))) {
    throw new FfmpegError(
      `フレームを 1 枚も書き出せませんでした（${formatSeconds(positionSec)} 秒に素材のフレームがありません）`,
      `ffmpeg ${args.join(' ')}`,
      0,
      stderr,
    )
  }
}

/**
 * 1 枚のサムネイル JPEG を生成する。
 * atSec 省略時は尺の 10% 地点。尺が取得できない素材では 0 秒を使う。
 */
export const createThumbnail = async (
  inputPath: string,
  outputPath: string,
  atSec?: number,
  runOptions?: RunOptions,
): Promise<void> => {
  const position =
    atSec === undefined
      ? thumbnailPositionSec(await probeMedia(inputPath))
      : PositionSec.parse(atSec)

  await writeSingleFrame(
    inputPath,
    outputPath,
    position,
    ['-vf', `scale=${THUMBNAIL_WIDTH}:-2`],
    runOptions,
  )
}

/**
 * Review 用のポスターフレームを等間隔で count 枚抽出する。
 * 生成したファイルパスを抽出順（＝時刻順）で返す。
 * フレームが count 枚より少ない動画では、同じフレームが何枚か並ぶ。
 */
export const extractPosterFrames = async (
  inputPath: string,
  outputDir: string,
  count: number,
  durationSec: number,
  fps: number | null,
  runOptions?: RunOptions,
): Promise<string[]> => {
  const positions = posterFramePositions(durationSec, count)
  await mkdir(outputDir, { recursive: true })

  const outputPaths: string[] = []
  for (const [index, position] of positions.entries()) {
    const outputPath = join(outputDir, posterFrameFileName(index))
    // 逐次実行する。並列に走らせると 1 素材で CPU を占有し、他のキューを遅らせるため。
    await writeSingleFrame(
      inputPath,
      outputPath,
      clampSeekSec(position, durationSec, fps),
      [],
      runOptions,
    )
    outputPaths.push(outputPath)
  }

  return outputPaths
}

/**
 * 最終フレームを 1 枚切り出す。**連続性の参照に使う**（ARCHITECTURE.md §8）。
 *
 * 末尾ぴったりではなく少し手前を取る。動画生成モデルは末尾が不安定になりやすく、
 * ブレたフレームを次の Shot の参照にすると連続性がかえって崩れるため。
 */
export const LAST_FRAME_BACKOFF_SEC = 0.1

export const extractLastFrame = async (
  inputPath: string,
  outputPath: string,
  durationSec: number,
  fps: number | null,
  runOptions?: RunOptions,
): Promise<void> => {
  const position = clampSeekSec(durationSec - LAST_FRAME_BACKOFF_SEC, durationSec, fps)
  await writeSingleFrame(inputPath, outputPath, position, [], runOptions)
}
