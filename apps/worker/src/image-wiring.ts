import { join } from 'node:path'
import {
  createImageJobRepository,
  createMediaAssetRepository,
  createProjectRepository,
  createShotReferenceRepository,
  createShotRepository,
  type DbClient,
} from '@ixa/db'
import type { GenerationContextSource, MediaAssetId, ProjectEventPublisher } from '@ixa/domain'
import {
  codexCliImageModel,
  createCodexCliImageProvider,
  createStubImageProvider,
  stubGeminiLikeImageModel,
} from '@ixa/provider-image'
import type { ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import type { ImageAdapter, ImageProcessorDeps } from './image/index.js'

/**
 * 絵コンテの画像を作る口（ADR-0029）。**どちらで作るかはジョブに記された口で決まる**（ADR-0032。
 * API が「使う AI」から決める）。ここは作れる口を並べるだけ。
 * Codex CLI は手元の CLI を呼び、契約の利用枠を使う（作るだけでは何も起動しない）。
 */
const imageAdapters = (workDir: string, stubOutputDir: string): readonly ImageAdapter[] => [
  { provider: createStubImageProvider({ outputDir: join(stubOutputDir, 'image') }), model: stubGeminiLikeImageModel },
  { provider: createCodexCliImageProvider({ workingDirRoot: join(workDir, 'codex') }), model: codexCliImageModel },
]

export const createImageWiring = (input: {
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
    adapters: imageAdapters(workDir, input.stubOutputDir),
    mediaQueue: input.mediaQueue,
    events: input.events,
    workDir,
    logger: input.logger,
  }
}
