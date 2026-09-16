import { readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { MediaAsset, MusicAnalysis, Project, Shot, Take } from '@ixa/domain'
import { posterFramePositions, probeMedia, runFfmpeg, type RunOptions } from '@ixa/media'
import type { BrandColorRequirement, FrameSample, ReviewMeasurements } from '@ixa/review'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { resolveBrandColor, type BrandColorTarget } from './brand-color.js'
import { analyzeRgbFrame } from './frame-stats.js'
import { withTempDir } from '../media/temp-dir.js'

/**
 * レビューの測定（ADR-0005 Stage 1 の入力づくり）。
 *
 * 判定そのものは `@ixa/review` の純粋関数が行う。ここは ffprobe / ffmpeg を叩いて
 * `ReviewMeasurements` を組み立てるところまでで、良し悪しを一切決めない。
 */

/** 等間隔に抜くフレームの枚数。増やすほど検出は上がるが、1 枚ごとに ffmpeg が 1 回走る。 */
export const REVIEW_FRAME_SAMPLE_COUNT = 5

/**
 * 解析用に縮小するサイズ。
 * 占有率は面積の比なので、拡大縮小しても（アスペクト比を崩しても）比そのものは変わらない。
 * 64x64 = 4096 ピクセルまで落とせば、1 フレームの走査が数ミリ秒で終わる。
 */
export const SAMPLE_FRAME_WIDTH = 64
export const SAMPLE_FRAME_HEIGHT = 64

/** ffmpeg / ffprobe のタイムアウト。長尺の原本でもシーク 1 回なので media キューほどは要らない。 */
export const REVIEW_FFMPEG_TIMEOUT_MS = 5 * 60 * 1000

const TEMP_DIR_PREFIX = 'review-job-'
const FALLBACK_EXTENSION = '.bin'

/** ffmpeg の -ss は文字列で受けるため、指数表記にならないよう固定小数で渡す。 */
const formatSeconds = (seconds: number): string => seconds.toFixed(6)

export type MeasureInput = {
  readonly take: Take
  readonly shot: Shot
  readonly project: Project
  readonly asset: MediaAsset
  readonly musicAnalysis: MusicAnalysis | null
  readonly brandColors: readonly BrandColorTarget[]
}

/**
 * 測定の口。実装は ffmpeg を使うが、processor はこの関数型だけを知る。
 * テストは実バイナリを起動せずに測定値を差し込める（CLAUDE.md のテスト方針）。
 */
export type TakeMeasurer = (input: MeasureInput) => Promise<ReviewMeasurements>

export type FfmpegMeasurerDeps = {
  readonly storage: ObjectStorage
  /** 一時ファイルの置き場。この下にジョブごとのディレクトリを掘り、必ず消す。 */
  readonly workDir: string
  readonly logger: Logger
  /** 既定 REVIEW_FRAME_SAMPLE_COUNT。 */
  readonly frameCount?: number
}

/** 判定側へ渡す要求。hex と tolerance は測定側の都合なので落とす。 */
const toRequirement = (target: BrandColorTarget): BrandColorRequirement => ({
  key: target.key,
  minRatio: target.minRatio,
  maxRatio: target.maxRatio,
})

/** 原本の拡張子は storageKey から取る（`media/{ws}/{id}/original.mp4`）。 */
const sourceFileName = (asset: MediaAsset): string => {
  const ext = extname(asset.storageKey)
  return `original${ext === '' ? FALLBACK_EXTENSION : ext}`
}

const download = async (
  storage: ObjectStorage,
  asset: MediaAsset,
  jobDir: string,
): Promise<string> => {
  const sourcePath = join(jobDir, sourceFileName(asset))
  await writeFile(sourcePath, await storage.get(asset.storageKey))
  return sourcePath
}

/**
 * 1 フレームを rgb24 の生バイト列として抜く。
 * JPEG にせず rawvideo で吐かせるのは、デコーダを増やさず、圧縮ノイズを色の比率に載せないため。
 */
const extractRgbFrame = async (
  sourcePath: string,
  outputPath: string,
  atSec: number,
  runOptions: RunOptions,
): Promise<Uint8Array> => {
  await runFfmpeg(
    [
      '-y',
      // -i より前の -ss は高速シーク。1 枚取り出すだけなので精度より速度を優先する。
      '-ss',
      formatSeconds(atSec),
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-vf',
      `scale=${SAMPLE_FRAME_WIDTH}:${SAMPLE_FRAME_HEIGHT}`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      outputPath,
    ],
    runOptions,
  )
  return readFile(outputPath)
}

const sampleFileName = (index: number): string => `frame-${String(index).padStart(3, '0')}.rgb`

/**
 * 原本をダウンロードして probe とフレーム抽出を行う測定器を作る。
 *
 * 尺が取れない素材ではフレームを抜けないため、空の `frames` を返す。
 * ここで throw しないのは、**判定するのは判定側の仕事**だからで、
 * `@ixa/review` の port は「frames が空なら fail」と決めている。
 */
export const createFfmpegMeasurer = (deps: FfmpegMeasurerDeps): TakeMeasurer => {
  const frameCount = deps.frameCount ?? REVIEW_FRAME_SAMPLE_COUNT

  return (input) =>
    withTempDir(deps.workDir, TEMP_DIR_PREFIX, async (jobDir) => {
      const runOptions: RunOptions = { timeoutMs: REVIEW_FFMPEG_TIMEOUT_MS }
      const sourcePath = await download(deps.storage, input.asset, jobDir)
      const probe = await probeMedia(sourcePath, runOptions)

      const durationSec = probe.durationSec ?? 0
      const colors = input.brandColors.map(resolveBrandColor)

      if (durationSec <= 0) {
        deps.logger.warn(
          { takeId: input.take.id, mediaAssetId: input.asset.id },
          '尺が取得できないためフレームを抽出できません。技術チェックで落とします',
        )
      }

      const positions = durationSec > 0 ? posterFramePositions(durationSec, frameCount) : []

      const frames: FrameSample[] = []
      for (const [index, atSec] of positions.entries()) {
        // 逐次に走らせる。並列にすると 1 Take で CPU を占有し、他のキューを遅らせる。
        const pixels = await extractRgbFrame(
          sourcePath,
          join(jobDir, sampleFileName(index)),
          atSec,
          runOptions,
        )
        const stats = analyzeRgbFrame(pixels, colors)
        frames.push({ atSec, meanLuma: stats.meanLuma, colorRatios: stats.colorRatios })
      }

      return {
        take: input.take,
        shot: input.shot,
        video: {
          durationSec,
          // 不明な値は 0 にする。null を混ぜるより、期待値と必ず食い違う値の方が判定側で素直に落ちる。
          width: probe.width ?? 0,
          height: probe.height ?? 0,
          fps: probe.fps ?? 0,
          hasAudioStream: probe.hasAudio,
        },
        frames,
        musicAnalysis: input.musicAnalysis,
        expected: {
          width: input.project.resolution.width,
          height: input.project.resolution.height,
          fps: input.project.fps,
        },
        brandColors: input.brandColors.map(toRequirement),
      }
    })
}
