import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MediaAssetRepository } from '@ixa/db'
import type { MediaAsset, MediaAssetId, Resolution, TimelineDocument } from '@ixa/domain'
import { needsRenderUpscale, type FrameSize } from '@ixa/media'
import type { ObjectStorage } from '@ixa/storage'
import { videoAssetIdsOf, withMediaUrls } from '@ixa/timeline'
import type { Logger } from 'pino'
import { registerFiles, startLocalFileServer } from './local-file-server.js'

/**
 * 書き出しの直前に、枠より小さい映像だけを Lanczos で拡大する（ADR-0045 段 3）。
 *
 * 書き出しは Remotion（headless Chrome）。小さい素材をそのまま渡すと Chrome が拡大し、
 * **それは bilinear 相当で輪郭が 13% 落ちる**（実機で測定）。だから先に ffmpeg で拡大しておく。
 *
 * **拡大が要る素材が 1 つも無ければ何もしない。** 文書をそのまま返し、一時ファイルも口も作らない。
 * いまの素材はすべて 1920x1080 なので、この段を足しても今日の書き出しの経路は変わらない。
 */

export type PreparedMedia = {
  readonly document: TimelineDocument
  /** 拡大した本数。0 なら何もしていない。 */
  readonly upscaled: number
  /** 一時ファイルと口を片付ける。**成功しても失敗しても必ず呼ぶ。** */
  readonly release: () => Promise<void>
}

export type PrepareMedia = (doc: TimelineDocument, frame: Resolution) => Promise<PreparedMedia>

export type MediaPreparerDeps = {
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly storage: Pick<ObjectStorage, 'get'>
  /** `@ixa/media` の `upscaleForRender`。テストで ffmpeg を使わないための差し込み口。 */
  readonly upscale: (input: string, output: string, frame: FrameSize) => Promise<void>
  readonly logger: Logger
}

const TEMP_DIR_PREFIX = 'ixa-render-media-'

const nothingToRelease = (): Promise<void> => Promise.resolve()

/** 大きさが分かっていて、枠より小さい映像だけ。**分からないものは触らない（推測しない）。** */
const pickTargets = async (
  deps: MediaPreparerDeps,
  doc: TimelineDocument,
  frame: FrameSize,
): Promise<readonly MediaAsset[]> => {
  const assets = await Promise.all(videoAssetIdsOf(doc).map((id) => deps.mediaAssets.findById(id)))
  return assets.flatMap((asset) => {
    if (asset === null || asset.kind !== 'video') return []
    const width = asset.probe?.width ?? null
    const height = asset.probe?.height ?? null
    if (width === null || height === null) {
      deps.logger.warn(
        { mediaAssetId: asset.id },
        '大きさが測れていない映像は拡大せずに書き出します（Chrome が拡大します）',
      )
      return []
    }
    return needsRenderUpscale({ width, height }, frame) ? [asset] : []
  })
}

/** 1 本ずつ拡大する（書き出しそのものが重いので並べない）。元の写しは拡大したら消す。 */
const upscaleAll = async (
  deps: MediaPreparerDeps,
  dir: string,
  targets: readonly MediaAsset[],
  frame: FrameSize,
): Promise<ReadonlyMap<MediaAssetId, string>> => {
  const outputs = new Map<MediaAssetId, string>()
  for (const asset of targets) {
    const source = join(dir, `${asset.id}-source`)
    const output = join(dir, `${asset.id}.mp4`)
    await writeFile(source, await deps.storage.get(asset.storageKey))
    await deps.upscale(source, output, frame)
    await rm(source, { force: true })
    outputs.set(asset.id, output)
  }
  return outputs
}

export const createMediaPreparer =
  (deps: MediaPreparerDeps): PrepareMedia =>
  async (doc, frame) => {
    const targets = await pickTargets(deps, doc, frame)
    if (targets.length === 0) return { document: doc, upscaled: 0, release: nothingToRelease }

    const dir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX))
    const removeDir = (): Promise<void> => rm(dir, { recursive: true, force: true })
    try {
      const outputs = await upscaleAll(deps, dir, targets, frame)
      const { tokenOf, table } = registerFiles(outputs)
      const server = await startLocalFileServer(table)
      const urls = new Map([...tokenOf].map(([id, token]) => [id, server.urlOf(token)] as const))

      deps.logger.info(
        { upscaled: targets.length, frame },
        '枠より小さい映像を書き出しの前に拡大しました',
      )
      return {
        document: withMediaUrls(doc, urls),
        upscaled: targets.length,
        release: async () => {
          await server.close()
          await removeDir()
        },
      }
    } catch (error) {
      await removeDir()
      throw new Error(`書き出しの前の拡大に失敗しました: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      })
    }
  }
