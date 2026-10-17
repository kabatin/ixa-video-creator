import {
  LocalServerHealth,
  localServerRequest,
  LocalServerRequestError,
  localServerUnreachableCode,
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
 *
 * **叩くのは 1 回だけ。** 判断の仕方は動画のサーバの `checkLocalServerHealth` と同じ（合言葉・形・起こし方）。
 */

/** 一覧を開くたびに叩くので短く（止まったサーバで画面を待たせない）。 */
const HEALTH_CHECK_TIMEOUT_MS = 2000

const WorkflowHealth = z.object({
  available: z.boolean(),
  loaded: z.boolean().optional(),
  reason: z.string().nullish(),
})
const Workflows = z.record(WorkflowHealth)
const VersionOnly = z.object({ version: z.string() })
const identity = SFX_API_IDENTITY

const workflowState = (body: unknown, workflowId: string, up: LocalServerHealthCheck): LocalServerHealthCheck => {
  const raw: unknown = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).workflows : undefined
  // workflow の一覧を返さない古い版は、応答していれば使えるとみなす（投入の 503 が理由を言う）。
  if (raw === undefined) return up
  const parsed = Workflows.safeParse(raw)
  // 一覧の形が違う。**全部使えるように見せない**（使えない方を選んで、投入で初めて断られる）。
  if (!parsed.success) return { state: 'down', reason: `${identity.serverName} の workflow の一覧の形が違います` }
  const label = SFX_API_MODELS.find((model) => model.workflowId === workflowId)?.label ?? workflowId
  const workflow = parsed.data[workflowId]
  if (workflow === undefined) return { state: 'down', reason: `${label}がこの ${identity.serverName} にありません` }
  if (!workflow.available) {
    const reason = workflow.reason?.trim() ?? ''
    return { state: 'down', reason: `${label}は今使えません（${reason === '' ? '理由不明' : reasonOf(reason)}）` }
  }
  return up
}

export const checkSfxApiHealth = async (input: {
  readonly baseUrl: string
  readonly token: string | null
  /** 見る workflow。省略はサーバが応答するかだけ。 */
  readonly workflowId?: string
  readonly fetch?: LocalServerFetch
}): Promise<LocalServerHealthCheck> => {
  try {
    const response = await localServerRequest(
      {
        identity,
        fetch: input.fetch ?? globalThis.fetch,
        baseUrl: input.baseUrl.replace(/\/+$/, ''),
        token: input.token,
        timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
      },
      'GET',
      '/v1/health',
    )
    if (response.status === 401 || response.status === 403) {
      return { state: 'down', reason: `合言葉（${identity.tokenEnvName}）が合いません` }
    }
    if (!response.ok) return { state: 'down', reason: `応答が異常です（${String(response.status)}）` }
    if (!LocalServerHealth.safeParse(response.body).success) {
      return {
        state: 'down',
        reason: `${identity.serverName} ではないものが応答しています（${identity.urlEnvName} を確かめてください）`,
      }
    }
    const version = VersionOnly.safeParse(response.body)
    const up: LocalServerHealthCheck = { state: 'up', version: version.success ? version.data.version : null }
    return input.workflowId === undefined ? up : workflowState(response.body, input.workflowId, up)
  } catch (error) {
    if (!(error instanceof LocalServerRequestError)) throw error
    return error.code === localServerUnreachableCode(identity)
      ? { state: 'down', reason: identity.startHint }
      : { state: 'down', reason: '応答がありません（時間切れか、接続が途中で切れました）' }
  }
}
