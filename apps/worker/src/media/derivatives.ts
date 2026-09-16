import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaKind, MediaProbe } from '@ixa/domain'
import { createProxy, createThumbnail, extractPosterFrames, type RunOptions } from '@ixa/media'

/**
 * 取り込みパイプラインの生成物を、まず一時ディレクトリの中だけで作る
 * （docs/ARCHITECTURE.md §7）。
 *
 * ffmpeg は自分で呼ばない。すべて `@ixa/media` のラッパ経由にすることで、
 * タイムアウト・stderr の保持・シェル非経由といった前提を 1 箇所に閉じ込める。
 */

export const PROXY_FILE_NAME = 'proxy.mp4'
export const THUMBNAIL_FILE_NAME = 'thumb.jpg'
export const POSTER_DIR_NAME = 'posters'

/** サムネイルを切り出す位置。冒頭は黒フレームやフェードインになりがちなので尺の 10% を採る。 */
const THUMBNAIL_POSITION_RATIO = 0.1

/** 一時ディレクトリ内に作られた生成物のパス。作らなかったものは null / 空配列。 */
export type LocalDerivatives = {
  readonly proxyPath: string | null
  readonly thumbnailPath: string | null
  readonly posterPaths: readonly string[]
}

/** audio / font / lut / other は probe だけを入れる。画像系の生成物は作らない。 */
const NO_DERIVATIVES: LocalDerivatives = {
  proxyPath: null,
  thumbnailPath: null,
  posterPaths: [],
}

export type BuildDerivativesInput = {
  readonly kind: MediaKind
  readonly sourcePath: string
  readonly outDir: string
  readonly probe: MediaProbe
  readonly posterCount: number
  readonly runOptions: RunOptions
}

/** 尺が取れない素材（静止画など）では 0 秒を使う。 */
const thumbnailPositionSec = (probe: MediaProbe): number =>
  probe.durationSec === null ? 0 : probe.durationSec * THUMBNAIL_POSITION_RATIO

/** ポスターフレームは尺が分かっている動画にしか引けない。 */
const canExtractPosters = (probe: MediaProbe): probe is MediaProbe & { durationSec: number } =>
  probe.durationSec !== null && probe.durationSec > 0

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
    return { proxyPath: null, thumbnailPath, posterPaths: [] }
  }

  const proxyPath = join(outDir, PROXY_FILE_NAME)
  await createProxy(sourcePath, proxyPath, undefined, runOptions)

  const posterPaths = canExtractPosters(probe)
    ? await extractPosterFrames(
        sourcePath,
        join(outDir, POSTER_DIR_NAME),
        posterCount,
        probe.durationSec,
        runOptions,
      )
    : []

  return { proxyPath, thumbnailPath, posterPaths }
}
