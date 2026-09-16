import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { MediaAsset } from '@ixa/domain'
import { posterKey, proxyKey, thumbnailKey, type ObjectStorage, type StorageKey,
  lastFrameKey,
} from '@ixa/storage'
import type { LocalDerivatives } from './derivatives.js'

/**
 * 一時ディレクトリの生成物をストレージへ格納する。
 * キーは必ず `@ixa/storage` の関数で組み立て、パス規約を手書きしない。
 */

const PROXY_CONTENT_TYPE = 'video/mp4'
const JPEG_CONTENT_TYPE = 'image/jpeg'

/** MediaAsset に書き戻す派生物のキー。作らなかったものは null / 空配列のまま。 */
export type DerivativeKeys = {
  readonly proxyKey: string | null
  readonly thumbnailKey: string | null
  /** UpdateMediaAssetPatch へそのまま渡すため可変配列で持つ。 */
  readonly posterKeys: string[]
  /** 最終フレーム。派生 MediaAsset を作るのは呼び出し側（processor）の責務。 */
  readonly lastFrameKey: string | null
  readonly lastFrameBytes: number
  readonly lastFrameChecksum: string | null
}

const putFile = async (
  storage: ObjectStorage,
  key: StorageKey,
  filePath: string,
  contentType: string,
): Promise<StorageKey> => {
  await storage.put(key, await readFile(filePath), { contentType })
  return key
}

/**
 * 生成物をすべて格納してからキーを返す。
 *
 * 途中で失敗した場合は呼び出し側が MediaAsset を更新しないため、DB には
 * 中途半端な状態が残らない。ストレージ側に残ったオブジェクトはキーが
 * 決定的なので、再実行時に同じキーへ上書きされる。
 */
export const storeDerivatives = async (
  storage: ObjectStorage,
  asset: MediaAsset,
  derivatives: LocalDerivatives,
): Promise<DerivativeKeys> => {
  const { workspaceId, id } = asset

  const storedProxyKey =
    derivatives.proxyPath === null
      ? null
      : await putFile(storage, proxyKey(workspaceId, id), derivatives.proxyPath, PROXY_CONTENT_TYPE)

  const storedThumbnailKey =
    derivatives.thumbnailPath === null
      ? null
      : await putFile(
          storage,
          thumbnailKey(workspaceId, id),
          derivatives.thumbnailPath,
          JPEG_CONTENT_TYPE,
        )

  const storedPosterKeys: StorageKey[] = []
  for (const [index, posterPath] of derivatives.posterPaths.entries()) {
    // 逐次で格納する。ポスターは時刻順に並んでいる必要があり、
    // 並列化しても 1 素材あたり数枚なので得るものが無い。
    storedPosterKeys.push(
      await putFile(storage, posterKey(workspaceId, id, index), posterPath, JPEG_CONTENT_TYPE),
    )
  }

  const lastFrame =
    derivatives.lastFramePath === null
      ? { key: null, bytes: 0, checksum: null }
      : await (async () => {
          const body = await readFile(derivatives.lastFramePath as string)
          const key = lastFrameKey(workspaceId, id)
          await storage.put(key, body, { contentType: JPEG_CONTENT_TYPE })
          return {
            key,
            bytes: body.byteLength,
            checksum: createHash('sha256').update(body).digest('hex'),
          }
        })()

  return {
    proxyKey: storedProxyKey,
    thumbnailKey: storedThumbnailKey,
    posterKeys: storedPosterKeys,
    lastFrameKey: lastFrame.key,
    lastFrameBytes: lastFrame.bytes,
    lastFrameChecksum: lastFrame.checksum,
  }
}
