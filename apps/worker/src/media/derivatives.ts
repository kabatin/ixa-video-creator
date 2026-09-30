import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaKind, MediaProbe } from '@ixa/domain'
import { createProxy, createThumbnail, extractPosterFrames, type RunOptions,
  extractLastFrame, seekableDurationSec, thumbnailPositionSec,
} from '@ixa/media'

/**
 * 取り込みパイプラインの生成物を、まず一時ディレクトリの中だけで作る
 * （docs/ARCHITECTURE.md §7）。
 *
 * ffmpeg は自分で呼ばない。すべて `@ixa/media` のラッパ経由にすることで、
 * タイムアウト・stderr の保持・シェル非経由といった前提を 1 箇所に閉じ込める。
 */

export const PROXY_FILE_NAME = 'proxy.mp4'
export const THUMBNAIL_FILE_NAME = 'thumb.jpg'
export const LAST_FRAME_FILE_NAME = 'last-frame.jpg'
const POSTER_DIR_NAME = 'posters'

/** 一時ディレクトリ内に作られた生成物のパス。作らなかったものは null / 空配列。 */
export type LocalDerivatives = {
  readonly proxyPath: string | null
  readonly thumbnailPath: string | null
  readonly posterPaths: readonly string[]
  /** 最終フレーム。次の Shot の生成へ参照として渡す（ARCHITECTURE.md §8）。 */
  readonly lastFramePath: string | null
}

/** audio / font / lut / other は probe だけを入れる。画像系の生成物は作らない。 */
const NO_DERIVATIVES: LocalDerivatives = {
  proxyPath: null,
  thumbnailPath: null,
  posterPaths: [],
  lastFramePath: null,
}

export type BuildDerivativesInput = {
  readonly kind: MediaKind
  readonly sourcePath: string
  readonly outDir: string
  readonly probe: MediaProbe
  readonly posterCount: number
  readonly runOptions: RunOptions
}

/** ポスターフレームと最終フレームは尺が分かっている動画にしか引けない。 */
const isKnownDuration = (durationSec: number | null): durationSec is number =>
  durationSec !== null && durationSec > 0

/**
 * kind ごとに必要な生成物だけを作る。
 *
 * | kind  | proxy | thumbnail | poster |
 * |-------|-------|-----------|--------|
 * | video | 作る  | 作る      | 作る   |
 * | image | 作らない | 作る   | 作らない |
 * | その他 | 作らない | 作らない | 作らない |
 */
export const buildDerivatives = async (
  input: BuildDerivativesInput,
): Promise<LocalDerivatives> => {
  const { kind, sourcePath, outDir, probe, posterCount, runOptions } = input

  if (kind !== 'video' && kind !== 'image') {
    return NO_DERIVATIVES
  }

  await mkdir(outDir, { recursive: true })

  const thumbnailPath = join(outDir, THUMBNAIL_FILE_NAME)
  // 位置を明示すると内部の追加 ffprobe が走らない。
  await createThumbnail(
    sourcePath,
    thumbnailPath,
    kind === 'image' ? 0 : thumbnailPositionSec(probe),
    runOptions,
  )

  if (kind === 'image') {
    return { proxyPath: null, thumbnailPath, posterPaths: [], lastFramePath: null }
  }

  const proxyPath = join(outDir, PROXY_FILE_NAME)
  await createProxy(sourcePath, proxyPath, undefined, runOptions)

  /**
   * 切り出す位置は映像ストリームの尺を基準にする。コンテナの尺は音声が映像より長いと
   * そちらに引っ張られ、映像がもう終わった位置を指してしまう。
   */
  const durationSec = seekableDurationSec(probe)

  const posterPaths = isKnownDuration(durationSec)
    ? await extractPosterFrames(
        sourcePath,
        join(outDir, POSTER_DIR_NAME),
        posterCount,
        durationSec,
        probe.fps,
        runOptions,
      )
    : []

  /**
   * 最終フレームは連続性の参照に使うため、ポスターフレームとは別に 1 枚切り出す。
   * ポスターは等間隔で末尾を踏まないので、最後の絵はここでしか取れない。
   */
  const lastFramePath = isKnownDuration(durationSec)
    ? await (async (): Promise<string> => {
        const path = join(outDir, LAST_FRAME_FILE_NAME)
        await extractLastFrame(sourcePath, path, durationSec, probe.fps, runOptions)
        return path
      })()
    : null

  return { proxyPath, thumbnailPath, posterPaths, lastFramePath }
}
