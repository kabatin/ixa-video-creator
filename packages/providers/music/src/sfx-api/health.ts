import {
  checkLocalServerHealth,
  localServerRequest,
  LocalServerRequestError,
  reasonOf,
  type LocalServerFetch,
  type LocalServerHealthCheck,
} from '@ixa/provider-video'
import { z } from 'zod'
import { SFX_API_IDENTITY, SFX_API_MODELS } from './descriptor.js'

/**
 * sfx-api の health（ADR-0052）。サーバが応答するかに加えて、**workflow ごとに使えるか**を見る。
 * `GET /v1/health` は `workflows: { [id]: { available, loaded, reason } }` を返す。
 * `available: true, loaded: false` は待機中のふつうの状態（初回に読み込む）。
 * 1 台で 2 つの AI（Stable Audio・MOSS）を出すので、片方だけ使えないことがある。
 */

const HEALTH_CHECK_TIMEOUT_MS = 2000

const WorkflowHealth = z.object({
  available: z.boolean(),
  loaded: z.boolean().optional(),
  reason: z.string().nullish(),
})
const HealthWithWorkflows = z.object({ workflows: z.record(WorkflowHealth) })

export const checkSfxApiHealth = async (input: {
  readonly baseUrl: string
  readonly token: string | null
  /** 見る workflow。省略はサーバが応答するかだけ。 */
  readonly workflowId?: string
  readonly fetch?: LocalServerFetch
}): Promise<LocalServerHealthCheck> => {
  const server = await checkLocalServerHealth({ identity: SFX_API_IDENTITY, ...input })
  if (server.state === 'down' || input.workflowId === undefined) return server
  const label = SFX_API_MODELS.find((model) => model.workflowId === input.workflowId)?.label ?? input.workflowId
  try {
    const response = await localServerRequest(
      {
        identity: SFX_API_IDENTITY,
        fetch: input.fetch ?? globalThis.fetch,
        baseUrl: input.baseUrl.replace(/\/+$/, ''),
        token: input.token,
        timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      },
      'GET',
      '/v1/health',
    )
    const parsed = HealthWithWorkflows.safeParse(response.body)
    // workflow の一覧を返さないサーバ（古い版）は、応答していれば使えるとみなす（投入の 503 が理由を言う）。
    if (!parsed.success) return server
    const workflow = parsed.data.workflows[input.workflowId]
    if (workflow === undefined) return { state: 'down', reason: `${label}がこの sfx-api にありません` }
    if (!workflow.available) {
      const reason = workflow.reason?.trim() ?? ''
      return { state: 'down', reason: `${label}は今使えません（${reason === '' ? '理由不明' : reasonOf(reason)}）` }
    }
    return server
  } catch (error) {
    if (!(error instanceof LocalServerRequestError)) throw error
    return { state: 'down', reason: '応答がありません（時間切れか、接続が途中で切れました）' }
  }
}
