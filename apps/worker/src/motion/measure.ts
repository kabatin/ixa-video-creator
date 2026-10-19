import { readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { MediaAsset } from '@ixa/domain'
import { probeMedia, runFfmpeg, seekableDurationSec, type RunOptions } from '@ixa/media'
import type { ObjectStorage } from '@ixa/storage'
import { frameEnergy, stripFrameTimes } from './frame-energy.js'

/**
 * Take の動きの測定（ADR-0054 §2・§3）。ffmpeg で灰色の小さなコマを抜いて動きの強さの列を作り、
 * Claude に見せるコマの帯（1 枚の画像）を作る。良し悪しは決めない。
 */

/** 動きの強さを測るコマの速さ。手元の動画 AI は 24fps の箱に 12 コマを 2 回ずつ入れている。 */
export const MOTION_SAMPLE_FPS = 12
export const MOTION_SAMPLE_WIDTH = 64
export const MOTION_SAMPLE_HEIGHT = 36
/** 帯のコマ数と並べ方（4 列 × 3 段）。 */
export const MOTION_STRIP_COLUMNS = 4
export const MOTION_STRIP_ROWS = 3
/** 帯の 1 コマの幅（px）。Claude が人の手足を見分けられる大きさ。 */
export const MOTION_STRIP_FRAME_WIDTH = 320

const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000

export type MotionMeasurement = {
  readonly durationSec: number
  readonly energyHopSec: number
  readonly energy: readonly number[]
  /** Claude に見せる帯。置き場は測定に渡したディレクトリの中。 */
  readonly strip: {
    readonly path: string
    readonly columns: number
    readonly frameTimesSec: readonly number[]
  }
}

/** 測定の口。processor はこの関数型だけを知る（テストで実バイナリを起こさない）。 */
export type MotionMeasurer = (asset: MediaAsset, jobDir: string) => Promise<MotionMeasurement>

/** ffmpeg の -ss は文字列で受けるため、指数表記にならないよう固定小数で渡す。 */
const formatSeconds = (seconds: number): string => seconds.toFixed(6)

const download = async (storage: ObjectStorage, asset: MediaAsset, jobDir: string): Promise<string> => {
  const ext = extname(asset.storageKey)
  const sourcePath = join(jobDir, `original${ext === '' ? '.bin' : ext}`)
  await writeFile(sourcePath, await storage.get(asset.storageKey))
  return sourcePath
}

const measureEnergy = async (sourcePath: string, jobDir: string, runOptions: RunOptions): Promise<readonly number[]> => {
  const rawPath = join(jobDir, 'motion.gray')
  await runFfmpeg(
    [
      '-y',
      '-i',
      sourcePath,
      '-an',
      '-vf',
      `fps=${String(MOTION_SAMPLE_FPS)},scale=${String(MOTION_SAMPLE_WIDTH)}:${String(MOTION_SAMPLE_HEIGHT)},format=gray`,
      '-f',
      'rawvideo',
      rawPath,
    ],
    runOptions,
  )
  return frameEnergy(await readFile(rawPath), MOTION_SAMPLE_WIDTH, MOTION_SAMPLE_HEIGHT)
}

const frameFileName = (index: number): string => `strip-${String(index).padStart(2, '0')}.jpg`

/** 帯を作る。コマは 1 枚ずつ時刻で抜き（逐次。CPU を占有しない）、tile で 1 枚に並べる。 */
const buildStrip = async (
  sourcePath: string,
  jobDir: string,
  frameTimesSec: readonly number[],
  runOptions: RunOptions,
): Promise<string> => {
  for (const [index, atSec] of frameTimesSec.entries()) {
    await runFfmpeg(
      [
        '-y',
        '-ss',
        formatSeconds(atSec),
        '-i',
        sourcePath,
        '-frames:v',
        '1',
        '-vf',
        `scale=${String(MOTION_STRIP_FRAME_WIDTH)}:-2`,
        join(jobDir, frameFileName(index)),
      ],
      runOptions,
    )
  }
  const stripPath = join(jobDir, 'strip.jpg')
  await runFfmpeg(
    [
      '-y',
      '-framerate',
      '1',
      '-i',
      join(jobDir, 'strip-%02d.jpg'),
      '-vf',
      `tile=${String(MOTION_STRIP_COLUMNS)}x${String(MOTION_STRIP_ROWS)}:padding=4:color=white`,
      '-frames:v',
      '1',
      stripPath,
    ],
    runOptions,
  )
  return stripPath
}

export const createFfmpegMotionMeasurer = (deps: { readonly storage: ObjectStorage }): MotionMeasurer =>
  async (asset, jobDir) => {
    const runOptions: RunOptions = { timeoutMs: FFMPEG_TIMEOUT_MS }
    const sourcePath = await download(deps.storage, asset, jobDir)
    const probe = await probeMedia(sourcePath, runOptions)
    // 映像の尺で測る（コンテナの尺は音声が長いとそちらに引っ張られる）。
    const durationSec = seekableDurationSec(probe) ?? 0
    if (durationSec <= 0) throw new Error(`動画の長さが分かりません: ${asset.id}`)
    const energy = await measureEnergy(sourcePath, jobDir, runOptions)
    const frameTimesSec = stripFrameTimes(durationSec, MOTION_STRIP_COLUMNS * MOTION_STRIP_ROWS)
    const stripPath = await buildStrip(sourcePath, jobDir, frameTimesSec, runOptions)
    return {
      durationSec,
      energyHopSec: 1 / MOTION_SAMPLE_FPS,
      energy,
      strip: { path: stripPath, columns: MOTION_STRIP_COLUMNS, frameTimesSec },
    }
  }
