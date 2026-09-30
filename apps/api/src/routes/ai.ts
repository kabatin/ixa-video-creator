import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
  AI_TOOLS,
  AiPurpose,
  AiSettings,
  AiToolId,
  aiChoiceProblem,
  recommendAiSettings,
  resolveAiSettings,
  type AiToolStatus,
} from '@ixa/domain'
import { VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse } from '../response.js'

/**
 * 使う AI（ADR-0032）。この環境で見つかった AI と、用途（テキスト・画像・動画）ごとの選択。
 *
 * **選べるかの規則は domain の `aiChoiceProblem` 1 か所。** 一覧の「選べない理由」と、保存の 422 が同じ文を言う。
 * API キーは扱わない（`.env` のまま。規約 6）。
 */

const Settings = AiSettings.openapi('AiSettings')

const ToolStatus = z
  .discriminatedUnion('state', [
    z.object({ state: z.literal('ready'), version: z.string().nullable() }),
    z.object({ state: z.literal('missing'), reason: z.string() }),
  ])
  .openapi('AiToolStatus')

const Tool = z
  .object({
    id: AiToolId,
    label: z.string(),
    status: ToolStatus,
    /** 用途ごとの選べない理由。選べるなら null。 */
    problems: z.object({
      text: z.string().nullable(),
      image: z.string().nullable(),
      video: z.string().nullable(),
    }),
  })
  .openapi('AiTool')

const ToolsData = z.object({ tools: z.array(Tool), recommended: Settings }).openapi('AiTools')

const SettingsData = z
  .object({ settings: Settings, source: z.enum(['saved', 'default']) })
  .openapi('AiSettingsState')

const toolsRoute = createRoute({
  method: 'get',
  path: '/ai/tools',
  tags: ['ai'],
  summary: 'この環境で見つかった AI と、用途ごとに選べるか',
  responses: {
    200: {
      description: '見つかった AI',
      content: { 'application/json': { schema: successResponse(ToolsData) } },
    },
  },
})

const getSettingsRoute = createRoute({
  method: 'get',
  path: '/ai/settings',
  tags: ['ai'],
  summary: '用途ごとに使う AI（まだ選んでいなければ環境変数の初期値）',
  responses: {
    200: {
      description: '使う AI',
      content: { 'application/json': { schema: successResponse(SettingsData) } },
    },
  },
})

const putSettingsRoute = createRoute({
  method: 'put',
  path: '/ai/settings',
  tags: ['ai'],
  summary: '用途ごとに使う AI を選ぶ',
  request: { body: { required: true, content: { 'application/json': { schema: Settings } } } },
  responses: {
    200: {
      description: '保存した選択',
      content: { 'application/json': { schema: successResponse(SettingsData) } },
    },
    422: errorContent('その用途に使えない、または見つからない AI を選んだ'),
  },
})

export type AiRoutesDeps = {
  readonly settings: {
    readonly get: () => Promise<AiSettings | null>
    readonly save: (settings: AiSettings) => Promise<AiSettings>
  }
  /** この環境で見つかった AI（`detectAiTools`）。 */
  readonly detect: () => Promise<Record<AiToolId, AiToolStatus>>
  /** まだ選んでいない間の初期値（`aiDefaultsFromEnv`）。 */
  readonly defaults: AiSettings
}

const problemsOf = (id: AiToolId, status: AiToolStatus) =>
  Object.fromEntries(
    AiPurpose.options.map((purpose) => [purpose, aiChoiceProblem(purpose, id, status)]),
  ) as Record<AiPurpose, string | null>

export const aiRoutes = (deps: AiRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(toolsRoute, async (c) => {
      const statuses = await deps.detect()
      const tools = AiToolId.options.map((id) => ({
        id,
        label: AI_TOOLS[id].label,
        status: statuses[id],
        problems: problemsOf(id, statuses[id]),
      }))
      return c.json(ok({ tools, recommended: recommendAiSettings(statuses) }), 200)
    })
    .openapi(getSettingsRoute, async (c) =>
      c.json(ok(resolveAiSettings(await deps.settings.get(), deps.defaults)), 200),
    )
    .openapi(putSettingsRoute, async (c) => {
      const chosen = c.req.valid('json')
      const statuses = await deps.detect()
      const problems = Object.fromEntries(
        AiPurpose.options.flatMap((purpose) => {
          const problem = aiChoiceProblem(purpose, chosen[purpose], statuses[chosen[purpose]])
          return problem === null ? [] : [[purpose, [problem]]]
        }),
      ) as Record<string, string[]>
      if (Object.keys(problems).length > 0)
        return c.json(fail(VALIDATION_ERROR_MESSAGE, problems), 422)
      const saved = await deps.settings.save(chosen)
      return c.json(ok({ settings: saved, source: 'saved' as const }), 200)
    })
