import { join } from 'node:path'
import { runFfmpeg } from '@ixa/media'

/**
 * テスト素材は ffmpeg 自身に作らせる（testsrc / sine）。
 * バイナリをリポジトリにコミットしないため。
 */

const SMALL_SIZE = '320x240'
const FPS = 10

/** 音声付きの短い動画。プロキシ・サムネ・ポスターの全経路を通すために使う。 */
export const makeTestVideo = async (
  dir: string,
  durationSec = 1.5,
  fileName = 'source.mp4',
): Promise<string> => {
  const outputPath = join(dir, fileName)
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc=size=${SMALL_SIZE}:rate=${String(FPS)}:duration=${String(durationSec)}`,
    '-f', 'lavfi',
    '-i', `sine=frequency=440:sample_rate=48000:duration=${String(durationSec)}`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '64k',
    '-shortest',
    outputPath,
  ])
  return outputPath
}

/**
 * 静止画。サムネイルだけが作られることの確認に使う。
 * 形式は拡張子で決まる。JPEG は image2 デマルチプレクサで読まれ、PNG とは ffmpeg の扱いが違う。
 */
export const makeTestImage = async (dir: string, ext: 'png' | 'jpg' = 'png'): Promise<string> => {
  const outputPath = join(dir, `source.${ext}`)
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc=size=${SMALL_SIZE}:rate=1:duration=1`,
    '-frames:v', '1',
    outputPath,
  ])
  return outputPath
}

/** 音声のみ。画像系の生成物が一切作られないことの確認に使う。 */
export const makeTestAudio = async (dir: string, durationSec = 1): Promise<string> => {
  const outputPath = join(dir, 'source.m4a')
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `sine=frequency=440:sample_rate=48000:duration=${String(durationSec)}`,
    '-c:a', 'aac',
    '-b:a', '64k',
    outputPath,
  ])
  return outputPath
}
