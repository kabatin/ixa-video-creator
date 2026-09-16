import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { runFfmpeg, type RunOptions} from './ffmpeg-runner.js'
import { probeMedia } from './probe.js'

/** サムネイルの既定位置。冒頭は黒フレームやフェードインになりがちなので尺の 10% を採る。 */
const DEFAULT_THUMBNAIL_POSITION_RATIO = 0.1
const THUMBNAIL_WIDTH = 640
const JPEG_QUALITY = '3'

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
      ? ((await probeMedia(inputPath)).durationSec ?? 0) * DEFAULT_THUMBNAIL_POSITION_RATIO
      : PositionSec.parse(atSec)

  await runFfmpeg([
    '-y',
    // -i より前の -ss は高速シーク。1 枚取り出すだけなので精度より速度を優先する。
    '-ss',
    formatSeconds(position),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${THUMBNAIL_WIDTH}:-2`,
    '-q:v',
    JPEG_QUALITY,
    outputPath,
  ], runOptions)
}

/**
 * Review 用のポスターフレームを等間隔で count 枚抽出する。
 * 生成したファイルパスを抽出順（＝時刻順）で返す。
 */
export const extractPosterFrames = async (
  inputPath: string,
  outputDir: string,
  count: number,
  durationSec: number,
  runOptions?: RunOptions,
): Promise<string[]> => {
  const positions = posterFramePositions(durationSec, count)
  await mkdir(outputDir, { recursive: true })

  const outputPaths: string[] = []
  for (const [index, position] of positions.entries()) {
    const outputPath = join(outputDir, posterFrameFileName(index))
    // 逐次実行する。並列に走らせると 1 素材で CPU を占有し、他のキューを遅らせるため。
    await runFfmpeg([
      '-y',
      '-ss',
      formatSeconds(position),
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-q:v',
      JPEG_QUALITY,
      outputPath,
    ], runOptions)
    outputPaths.push(outputPath)
  }

  return outputPaths
}
