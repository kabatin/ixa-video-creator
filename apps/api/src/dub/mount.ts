import { OpenAPIHono } from '@hono/zod-openapi'
import { validationHook } from '../errors.js'
import { characterVoiceDesignRoutes } from '../routes/character-voice-design.js'
import { shotDubRoutes } from '../routes/shot-dub.js'
import type { DubRoutesDeps } from './deps.js'

/** 声の差し替え（ADR-0062 段 5b）の口をまとめて 1 つにする（差し替え・状態・取り消し・動いている一覧・説明から声を作る）。 */
export const dubRouter = (deps: DubRoutesDeps): OpenAPIHono => {
  const router = new OpenAPIHono({ defaultHook: validationHook })
  router.route('/', shotDubRoutes(deps))
  router.route('/', characterVoiceDesignRoutes(deps))
  return router
}
