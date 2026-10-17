import {
  createMediaAssetRepository,
  createProjectRepository,
  createThumbnailRepository,
  type DbClient,
} from '@ixa/db'
import type { MediaAssetId } from '@ixa/domain'
import { renderThumbnailStill } from '@ixa/render'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { ThumbnailProcessorDeps } from './thumbnail/index.js'

/**
 * YouTube のサムネイルを描く口（ADR-0051）。描くのは書き出しと同じ Remotion のバンドル（同じプロセスで 1 度だけ作る）。
 * JPEG は一時的に `THUMBNAIL_OUTPUT_DIR` に書き、置き場へ入れたら消す。
 */
export const createThumbnailWiring = (input: {
  readonly db: DbClient
  readonly storage: ObjectStorage
  /** 大きさ・プレビュー用の派生物を作る media キュー（書き出しと同じ）。 */
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly logger: Logger
}): ThumbnailProcessorDeps => ({
  thumbnails: createThumbnailRepository(input.db),
  projects: createProjectRepository(input.db),
  mediaAssets: createMediaAssetRepository(input.db),
  storage: input.storage,
  renderStill: renderThumbnailStill,
  outputDir: process.env.THUMBNAIL_OUTPUT_DIR ?? '/tmp/ixa-thumbnail-output',
  mediaQueue: input.mediaQueue,
  logger: input.logger,
})
