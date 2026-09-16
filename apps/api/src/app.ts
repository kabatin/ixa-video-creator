import { OpenAPIHono } from '@hono/zod-openapi'
import type { ProjectRepository } from '@ixa/db'
import { registerErrorHandlers, validationHook } from './errors.js'
import type { Logger } from './logger.js'
import { registerOpenApiDocument } from './openapi.js'
import { healthRoutes } from './routes/health.js'
import { projectRoutes } from './routes/projects.js'

/**
 * アプリが必要とする依存。DB 接続やロガーの生成はここでは行わず、
 * 呼び出し側（main.ts / テスト）から注入する。
 */
export type AppDeps = {
  projects: ProjectRepository
  logger: Logger
}

/**
 * Hono アプリを組み立てる。
 * モジュールのトップレベルでは DB へ接続しない（テストは偽の Repository を渡す）。
 */
export const createApp = ({ projects, logger }: AppDeps) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })

  app.route('/', healthRoutes())
  app.route('/', projectRoutes({ projects }))

  registerOpenApiDocument(app)
  registerErrorHandlers(app, logger)

  return app
}

export type App = ReturnType<typeof createApp>
