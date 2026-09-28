import { join } from 'node:path'
import type { AppConfig } from '@ixa/config'
import {
  createImageJobRepository,
  createMediaAssetRepository,
  createProjectRepository,
  createShotReferenceRepository,
  createShotRepository,
  type DbClient,
} from '@ixa/db'
import type { GenerationContextSource, MediaAssetId, ProjectEventPublisher } from '@ixa/domain'
import type { ImageModelDescriptor, ImageProvider } from '@ixa/provider-core'
import {
  codexCliImageModel,
  createCodexCliImageProvider,
  createStubImageProvider,
  stubGeminiLikeImageModel,
} from '@ixa/provider-image'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { ImageProcessorDeps } from './image/index.js'

/**
 * 絵コンテの画像を作る口（ADR-0029）。**`IMAGE_PROVIDER` で決める。既定はスタブ（仮の絵、費用なし）。**
 * `codex_cli` は手元の Codex CLI を呼び、契約の利用枠を使う。
 */
const providerFor = (
  config: AppConfig,
  workDir: string,
  stubOutputDir: string,
): { readonly provider: ImageProvider; readonly model: ImageModelDescriptor } =>
  config.imageProvider === 'codex_cli'
    ? { provider: createCodexCliImageProvider({ workingDirRoot: join(workDir, 'codex') }), model: codexCliImageModel }
    : { provider: createStubImageProvider({ outputDir: join(stubOutputDir, 'image') }), model: stubGeminiLikeImageModel }

export const createImageWiring = (input: {
  readonly config: AppConfig
  readonly db: DbClient
  readonly storage: ObjectStorage
  readonly context: GenerationContextSource
  readonly mediaQueue: { readonly enqueue: (mediaAssetId: MediaAssetId) => Promise<void> }
  readonly events: ProjectEventPublisher
  readonly logger: Logger
  readonly stubOutputDir: string
}): ImageProcessorDeps => {
  const workDir = process.env.IMAGE_WORK_DIR ?? '/tmp/ixa-image-work'
  return {
    imageJobs: createImageJobRepository(input.db),
    shots: createShotRepository(input.db),
    projects: createProjectRepository(input.db),
    mediaAssets: createMediaAssetRepository(input.db),
    shotReferences: createShotReferenceRepository(input.db),
    storage: input.storage,
    context: input.context,
    ...providerFor(input.config, workDir, input.stubOutputDir),
    mediaQueue: input.mediaQueue,
    events: input.events,
    workDir,
    logger: input.logger,
  }
}
