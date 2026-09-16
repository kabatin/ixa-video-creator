import type { OpenAPIHono } from '@hono/zod-openapi'
import type { Env } from 'hono'

/** OpenAPI ドキュメントの配信パス。 */
export const OPENAPI_DOC_PATH = '/openapi.json'

export const OPENAPI_INFO = {
  title: 'ixa-video-creator API',
  version: '0.1.0',
  description: 'AI ネイティブ映像制作プラットフォームの API（docs/ARCHITECTURE.md §18）',
} as const

/** `/openapi.json` を生やす。route 定義から自動生成される。 */
export const registerOpenApiDocument = <E extends Env>(app: OpenAPIHono<E>): OpenAPIHono<E> => {
  app.doc(OPENAPI_DOC_PATH, { openapi: '3.0.0', info: OPENAPI_INFO })
  return app
}
