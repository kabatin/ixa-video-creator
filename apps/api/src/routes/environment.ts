import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { EnvironmentStatus } from '@ixa/config'
import { validationHook } from '../errors.js'
import { ok, successResponse } from '../response.js'

/**
 * この環境が何につながっていて、何にお金が掛かるかを返す（A 案）。
 *
 * **秘密の値は返さない。設定する口も置かない。**
 * この API は無認証で全インターフェースに待ち受けている（`TCP *:3001`）。
 * 値を返せば同じ網にいる誰でも課金される鍵を読め、書ける口を置けば差し替えられる。
 * 鍵は `.env` に置いたまま、画面には「設定されているか」までを出す（規約 6）。
 *
 * スキーマでも値を持てない形にしてある。あとから足そうとすると型で止まる。
 */

const SecretStatus = z
  .object({
    label: z.string(),
    envName: z.string(),
    configured: z.boolean(),
    /** 文字数だけ。貼り漏れを確かめるためで、値そのものは返さない。 */
    length: z.number().int().positive().nullable(),
    purpose: z.string(),
  })
  .strict()
  .openapi('SecretStatus')

const EnvironmentSetting = z
  .object({
    label: z.string(),
    envName: z.string(),
    value: z.string(),
    notable: z.boolean(),
    note: z.string(),
  })
  .strict()
  .openapi('EnvironmentSetting')

const EnvironmentData = z
  .object({
    secrets: z.array(SecretStatus),
    settings: z.array(EnvironmentSetting),
  })
  .strict()
  .openapi('Environment')

const environmentRoute = createRoute({
  method: 'get',
  path: '/environment',
  tags: ['environment'],
  summary: 'この環境の接続先と、お金に効く設定（**秘密の値は返さない**）',
  responses: {
    200: {
      description: '鍵が設定されているかと、実行の設定',
      content: { 'application/json': { schema: successResponse(EnvironmentData) } },
    },
  },
})

export type EnvironmentDeps = {
  /** `describeEnvironment(config)` の結果。ルートが config を直接読まない。 */
  readonly status: () => EnvironmentStatus
}

export const environmentRoutes = (deps: EnvironmentDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(environmentRoute, (c) =>
    // `.strict()` なので、余分な項目（値など）が混ざれば parse で落ちる。
    c.json(ok(EnvironmentData.parse(deps.status())), 200),
  )
