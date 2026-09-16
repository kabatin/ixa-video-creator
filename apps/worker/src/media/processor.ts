import { writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { MediaAssetRepository } from '@ixa/db'
import { MediaAssetId as MediaAssetIdSchema, type MediaAsset, type MediaProbe } from '@ixa/domain'
import { probeMedia, type RunOptions } from '@ixa/media'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { z } from 'zod'
import { buildDerivatives } from './derivatives.js'
import { storeDerivatives } from './store.js'
import { withTempDir } from './temp-dir.js'

/**
 * media キューのジョブ処理（docs/ARCHITECTURE.md §7 の取り込みパイプライン）。
 *
 * - ジョブデータは ID のみ。実データは DB から読む（DB が真実。ADR-0008）
 * - 冪等。取り込み済みの MediaAsset を再処理しない（判定は `isIngested`）
 * - 一時ディレクトリはジョブごとに分け、成功・失敗のどちらでも必ず片付ける
 */

export const MediaJobData = z.object({ mediaAssetId: MediaAssetIdSchema })
export type MediaJobData = z.infer<typeof MediaJobData>

/** Review 用に抜くポスターフレームの既定枚数。 */
export const DEFAULT_POSTER_COUNT = 5

/**
 * ffmpeg / ffprobe のタイムアウト。
 * `@ixa/media` の既定（5 分）では長尺素材のプロキシ生成に足りないため延長する。
 */
export const MEDIA_TIMEOUT_MS = 10 * 60 * 1000

/** 一時ディレクトリの接頭辞。ジョブごとに mkdtemp で一意化する。 */
const TEMP_DIR_PREFIX = 'media-job-'

/** ダウンロードした原本の拡張子が分からないときのフォールバック。 */
const FALLBACK_EXTENSION = '.bin'

const PosterCount = z.number().int().positive()

export type MediaProcessorDeps = {
  readonly mediaAssets: MediaAssetRepository
  readonly storage: ObjectStorage
  /** 一時ファイルの置き場。この下にジョブごとのディレクトリを掘る。 */
  readonly workDir: string
  readonly logger: Logger
  /** 既定 DEFAULT_POSTER_COUNT。 */
  readonly posterCount?: number
}

export type MediaOutcome =
  | { readonly state: 'skipped'; readonly reason: string }
  | { readonly state: 'processed'; readonly probe: MediaProbe; readonly posterCount: number }
  | { readonly state: 'failed'; readonly code: string }

/** FfmpegError / StorageError など code を持つエラーからコードを取り出す。 */
const errorCodeOf = (error: unknown): string => {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  return error instanceof Error ? error.name : 'unknown_error'
}

/**
 * 取り込み済みかどうかを判定する。
 *
 * **`probe` の有無では判定できない。** probe はこのパイプライン以外も書き込む。
 * render は出力 MediaAsset を作る時点で尺だけの probe を自分で入れるため
 * （`apps/worker/src/render/processor.ts`）、probe を根拠にすると
 * media ジョブが必ず skip され、レンダリング結果のポスターフレームが
 * **永久に 1 枚も作られない**。実データで実際にそうなっていた。
 * skip は成功として返るので、この欠落は下流からは見えない。
 *
 * 根拠には kind ごとに「取り込みが成功したなら必ず残るもの」だけを使う。
 * `posterKeys` は尺が取れない動画では正常に空となるため根拠にしない。
 */
const isIngested = (asset: MediaAsset): boolean => {
  // video は proxy とサムネイルを必ず作る（derivatives.ts の表を参照）。
  if (asset.kind === 'video') return asset.proxyKey !== null && asset.thumbnailKey !== null
  if (asset.kind === 'image') return asset.thumbnailKey !== null
  // audio / font / lut / other は派生物を作らないので probe だけが成果物になる。
  return asset.probe !== null
}

/** 原本の拡張子は storageKey から取る（`media/{ws}/{id}/original.mp4`）。 */
const sourceFileName = (asset: MediaAsset): string => {
  const ext = extname(asset.storageKey)
  return `original${ext === '' ? FALLBACK_EXTENSION : ext}`
}

/** ストレージから一時ディレクトリへ原本を落とす。 */
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
 * probe → 生成物作成 → 格納 → DB 反映。
 * 生成物は一時ディレクトリで作り切ってから格納し、最後に 1 回だけ update する。
 * 途中で throw すれば MediaAsset は元のまま残る（部分的な状態を作らない）。
 */
const ingest = async (
  deps: MediaProcessorDeps,
  asset: MediaAsset,
  posterCount: number,
  jobDir: string,
): Promise<MediaOutcome> => {
  const runOptions: RunOptions = { timeoutMs: MEDIA_TIMEOUT_MS }

  const sourcePath = await download(deps.storage, asset, jobDir)
  const probe = await probeMedia(sourcePath, runOptions)

  const derivatives = await buildDerivatives({
    kind: asset.kind,
    sourcePath,
    outDir: join(jobDir, 'derivatives'),
    probe,
    posterCount,
    runOptions,
  })

  const keys = await storeDerivatives(deps.storage, asset, derivatives)

  /**
   * 最終フレームは**独立した MediaAsset** にする。
   * 次の Shot の生成へ参照画像として渡すため、MediaAssetId で指せる必要がある
   * （`ShotGenerationSpec.references` は MediaAssetId を持つ）。
   * ポスターフレームはレビュー用でキーのままでよいが、これだけは別扱いになる。
   */
  const lastFrameAssetId =
    keys.lastFrameKey === null || keys.lastFrameChecksum === null
      ? null
      : (
          await deps.mediaAssets.create({
            workspaceId: asset.workspaceId,
            projectId: asset.projectId,
            kind: 'image',
            storageKey: keys.lastFrameKey,
            mimeType: 'image/jpeg',
            bytes: keys.lastFrameBytes,
            checksumSha256: keys.lastFrameChecksum,
            origin: { type: 'derived', sourceAssetId: asset.id, operation: 'last_frame' },
            tags: ['last_frame'],
          })
        ).id

  await deps.mediaAssets.update(asset.id, {
    probe,
    proxyKey: keys.proxyKey,
    thumbnailKey: keys.thumbnailKey,
    posterKeys: keys.posterKeys,
    lastFrameAssetId,
  })

  deps.logger.info(
    { mediaAssetId: asset.id, kind: asset.kind, posterCount: keys.posterKeys.length },
    'MediaAsset の取り込みが完了しました',
  )

  return { state: 'processed', probe, posterCount: keys.posterKeys.length }
}

/**
 * media ジョブを 1 件処理する。
 * MediaAsset が無い場合だけ throw する（ジョブデータが壊れている＝再試行しても直らない
 * が、握り潰すと原因が消えるため）。処理中の失敗は failed として返す。
 */
export const processMediaJob = async (
  deps: MediaProcessorDeps,
  data: unknown,
): Promise<MediaOutcome> => {
  const { mediaAssetId } = MediaJobData.parse(data)

  const asset = await deps.mediaAssets.findById(mediaAssetId)
  if (asset === null) {
    throw new Error(`MediaAsset が見つかりません: ${mediaAssetId}`)
  }

  // 冪等性の要。取り込み済みの素材を再処理して ffmpeg を無駄に回さない。
  if (isIngested(asset)) {
    deps.logger.debug(
      { mediaAssetId, kind: asset.kind },
      '取り込み済みの MediaAsset なので何もしません',
    )
    return { state: 'skipped', reason: 'already_ingested' }
  }

  const posterCount = PosterCount.parse(deps.posterCount ?? DEFAULT_POSTER_COUNT)

  try {
    return await withTempDir(deps.workDir, TEMP_DIR_PREFIX, (jobDir) =>
      ingest(deps, asset, posterCount, jobDir),
    )
  } catch (error) {
    const code = errorCodeOf(error)
    deps.logger.error({ mediaAssetId, code, err: error }, 'MediaAsset の取り込みに失敗しました')
    return { state: 'failed', code }
  }
}
