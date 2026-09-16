import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { validationHook } from '../errors.js'
import { ok, successResponse } from '../response.js'

const HealthData = z
  .object({
    status: z.literal('ok'),
    uptimeSec: z.number().nonnegative().openapi({ description: 'プロセス起動からの秒数' }),
  })
  .openapi('Health')

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['health'],
  summary: 'ヘルスチェック（DB 接続は確認しない）',
  responses: {
    200: {
      description: 'サーバが応答できる',
      content: { 'application/json': { schema: successResponse(HealthData) } },
    },
  },
})

export const healthRoutes = () =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(healthRoute, (c) =>
    c.json(ok({ status: 'ok' as const, uptimeSec: process.uptime() }), 200),
  )
