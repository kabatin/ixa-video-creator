import { z } from 'zod'
import { LocalServerHealth } from './api.js'
import type { LocalServerHealthCheck } from './health-check.js'
import { localServerRequest, LocalServerRequestError, reasonOf, type LocalServerFetch } from './http.js'
import { localServerUnreachableCode, type LocalServerIdentity } from './identity.js'

/**
 * 1 台で複数の workflow を出す手元のサーバ（sfx-api・ace-step-api・klein-api）の health。サーバが応答するかに加えて、
 * **workflow ごとに使えるか**を見る。`GET /v1/health` は `workflows: { [id]: { available, loaded, reason } }` を返す。
 * `available: true, loaded: false` は待機中のふつうの状態（初回に読み込む）。一部だけ使えないことがある。
 *
 * **叩くのは 1 回だけ。** 判断の仕方は動画のサーバの `checkLocalServerHealth` と同じ（合言葉・形・起こし方）。
 */

/** 一覧を開くたびに叩くので短く（止まったサーバで画面を待たせない）。 */
const HEALTH_CHECK_TIMEOUT_MS = 2000

const QualityHealth = z.object({ available: z.boolean(), reason: z.string().nullish() })
const WorkflowHealth = z.object({
  available: z.boolean(),
  loaded: z.boolean().optional(),
  reason: z.string().nullish(),
  /**
   * 段ごとに重みが違う workflow（klein-api の flux2-klein: standard = 9B・draft = 4B）。古い版は返さない。
   * 段の無い workflow には klein-api 0.1.1 が `null` を返す（省かない）ので、null も「段なし」として受ける。
   */
  qualities: z.record(QualityHealth).nullish(),
})
const Workflows = z.record(WorkflowHealth)
const VersionOnly = z.object({ version: z.string() })

export type WorkflowHealthInput = {
  readonly baseUrl: string
  readonly token: string | null
  /** 見る workflow。省略はサーバが応答するかだけ。 */
  readonly workflowId?: string
  /** 見る段（`qualities` の鍵）。省略は workflow が使えるかだけ。段を返さない古い版も workflow で見る。 */
  readonly quality?: string
  readonly fetch?: LocalServerFetch
}

export type WorkflowHealthOptions = {
  /**
   * workflow の一覧を返さない古い版にもあった workflow。省略は「どれもあった」とみなす（sfx-api・ace-step-api）。
   * 渡すと、古い版でこれ以外を頼まれたときは「無い」と答える（klein-api の z-image-turbo は新しい版にしか無い。ADR-0065）。
   */
  readonly legacyWorkflows?: readonly string[]
}

/** 段を見る。段の一覧を返さない古い版は、workflow が使えれば段も使えるとみなす（今までどおり）。 */
const qualityState = (
  identity: LocalServerIdentity,
  label: string,
  qualities: z.infer<typeof WorkflowHealth>['qualities'],
  quality: string | undefined,
  up: LocalServerHealthCheck,
): LocalServerHealthCheck => {
  if (quality === undefined || qualities === undefined || qualities === null) return up
  const found = qualities[quality]
  if (found === undefined) return { state: 'down', reason: `${label}がこの ${identity.serverName} にありません` }
  if (found.available) return up
  const reason = found.reason?.trim() ?? ''
  return { state: 'down', reason: `${label}は今使えません（${reason === '' ? '理由不明' : reasonOf(reason)}）` }
}

const workflowState = (
  identity: LocalServerIdentity,
  label: string,
  body: unknown,
  workflowId: string,
  quality: string | undefined,
  up: LocalServerHealthCheck,
  options: WorkflowHealthOptions,
): LocalServerHealthCheck => {
  const raw: unknown = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).workflows : undefined
  // workflow の一覧を返さない古い版は、応答していれば使えるとみなす（投入の失敗が理由を言う）。
  // 古い版に無かった workflow だけは「無い」と答える（選べるように見せて投入で 404 にしない）。
  if (raw === undefined) {
    const legacy = options.legacyWorkflows
    return legacy === undefined || legacy.includes(workflowId)
      ? up
      : { state: 'down', reason: `${label}はこの ${identity.serverName} にありません（${identity.serverName} を新しい版にしてください）` }
  }
  const parsed = Workflows.safeParse(raw)
  // 一覧の形が違う。**全部使えるように見せない**（使えない方を選んで、投入で初めて断られる）。
  if (!parsed.success) return { state: 'down', reason: `${identity.serverName} の workflow の一覧の形が違います` }
  const workflow = parsed.data[workflowId]
  if (workflow === undefined) return { state: 'down', reason: `${label}がこの ${identity.serverName} にありません` }
  if (!workflow.available) {
    const reason = workflow.reason?.trim() ?? ''
    return { state: 'down', reason: `${label}は今使えません（${reason === '' ? '理由不明' : reasonOf(reason)}）` }
  }
  return qualityState(identity, label, workflow.qualities, quality, up)
}

/** `labelOf` は workflow（と段）の画面の名前（知らなければ workflow の名前のまま出す）。 */
export const checkWorkflowHealth = async (
  identity: LocalServerIdentity,
  labelOf: (workflowId: string, quality?: string) => string | undefined,
  input: WorkflowHealthInput,
  options: WorkflowHealthOptions = {},
): Promise<LocalServerHealthCheck> => {
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
    const { workflowId, quality } = input
    if (workflowId === undefined) return up
    return workflowState(identity, labelOf(workflowId, quality) ?? workflowId, response.body, workflowId, quality, up, options)
  } catch (error) {
    if (!(error instanceof LocalServerRequestError)) throw error
    return error.code === localServerUnreachableCode(identity)
      ? { state: 'down', reason: identity.startHint }
      : { state: 'down', reason: '応答がありません（時間切れか、接続が途中で切れました）' }
  }
}
