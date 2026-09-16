import { OpenAPIHono } from '@hono/zod-openapi'
import type {
  GenerationJobRepository, MediaAssetRepository, ProjectRepository, ShotRepository, TakeRepository,
} from '@ixa/db'
import type { GenerationContextSource } from '@ixa/domain'
import type { ProviderRegistry } from '@ixa/provider-core'
import type { ObjectStorage } from '@ixa/storage'
import { registerErrorHandlers, validationHook } from './errors.js'
import type { Logger } from './logger.js'
import { registerOpenApiDocument } from './openapi.js'
import { healthRoutes } from './routes/health.js'
import { mediaRoutes } from './routes/media.js'
import { projectRoutes } from './routes/projects.js'
import { shotRoutes, type GenerationQueue } from './routes/shots.js'
import { uploadRoutes } from './routes/uploads.js'

/**
 * アプリが必要とする依存。DB 接続やロガーの生成はここでは行わず、
 * 呼び出し側（main.ts / テスト）から注入する。
 */
export type AppDeps = {
  projects: ProjectRepository
  mediaAssets: MediaAssetRepository
  shots: ShotRepository
  takes: TakeRepository
  generationJobs: GenerationJobRepository
  registry: ProviderRegistry
  generationContext: GenerationContextSource
  generationQueue: GenerationQueue
  storage: ObjectStorage
  logger: Logger
}

/**
 * Hono アプリを組み立てる。
 * モジュールのトップレベルでは DB へ接続しない（テストは偽の Repository を渡す）。
 */
export const createApp = (deps: AppDeps) => {
  const { projects, mediaAssets, storage, logger } = deps
  const app = new OpenAPIHono({ defaultHook: validationHook })

  app.route('/', healthRoutes())
  app.route('/', projectRoutes({ projects }))
  app.route('/', uploadRoutes({ mediaAssets, storage }))
  app.route('/', mediaRoutes({ mediaAssets, storage }))
  app.route(
    '/',
    shotRoutes({
      shots: deps.shots,
      projects,
      takes: deps.takes,
      generationJobs: deps.generationJobs,
      registry: deps.registry,
      context: deps.generationContext,
      queue: deps.generationQueue,
    }),
  )

  registerOpenApiDocument(app)
  registerErrorHandlers(app, logger)

  return app
}

export type App = ReturnType<typeof createApp>
