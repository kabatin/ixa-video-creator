import { OpenAPIHono } from '@hono/zod-openapi'
import type { MediaAssetRepository, ProjectRepository } from '@ixa/db'
import type { ObjectStorage } from '@ixa/storage'
import { registerErrorHandlers, validationHook } from './errors.js'
import type { Logger } from './logger.js'
import { registerOpenApiDocument } from './openapi.js'
import { healthRoutes } from './routes/health.js'
import { mediaRoutes } from './routes/media.js'
import { projectRoutes } from './routes/projects.js'
import { uploadRoutes } from './routes/uploads.js'

/**
 * アプリが必要とする依存。DB 接続やロガーの生成はここでは行わず、
 * 呼び出し側（main.ts / テスト）から注入する。
 */
export type AppDeps = {
  projects: ProjectRepository
  mediaAssets: MediaAssetRepository
  storage: ObjectStorage
  logger: Logger
}

/**
 * Hono アプリを組み立てる。
 * モジュールのトップレベルでは DB へ接続しない（テストは偽の Repository を渡す）。
 */
export const createApp = ({ projects, mediaAssets, storage, logger }: AppDeps) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })

  app.route('/', healthRoutes())
  app.route('/', projectRoutes({ projects }))
  app.route('/', uploadRoutes({ mediaAssets, storage }))
  app.route('/', mediaRoutes({ mediaAssets, storage }))

  registerOpenApiDocument(app)
  registerErrorHandlers(app, logger)

  return app
}

export type App = ReturnType<typeof createApp>
