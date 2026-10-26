import { VoiceProviderError, voiceFailureFromStatus } from '@ixa/provider-core'
import type { z } from 'zod'
import { badResponse, type FetchLike } from './http.js'

/**
 * Gemini への要求の共通の口（ADR-0062）。待って送り直す。ナレーションの読み上げにも効く。
 *
 * - 429: 返答の「retry in 48s」「retry in 19h22m6s」の秒数 +2 秒待つ（見つからなければ 30 秒）。最大 4 回。
 *   待つのが 90 秒を超えるなら、待たずに理由を出して止める（1 日の上限に当たっている）
 * - 500 以上: 2・5・10 秒待って 3 回まで
 * - 1 回の要求は 180 秒で打ち切る
 *
 * 待つ口（`sleep`）は差し替えられる（テストは待たない）。**鍵・原稿・返答の本文はエラーの文に入れない。**
 */

export const GEMINI_TIMEOUT_MS = 180_000
export const GEMINI_MAX_RATE_LIMIT_RETRIES = 4
export const GEMINI_MAX_RATE_LIMIT_WAIT_SEC = 90
export const GEMINI_SERVER_RETRY_WAITS_SEC = [2, 5, 10] as const
/** 429 の返答に秒数が無いときに待つ長さ。 */
const DEFAULT_RATE_LIMIT_SEC = 30
const RATE_LIMIT_MARGIN_SEC = 2
/** 秒数を探す本文の長さ（頭から）。 */
const BODY_SCAN_CHARS = 600
const WHO = 'Gemini'

export type GeminiRequestDeps = {
  readonly apiKey: string
  readonly fetch: FetchLike
  /** 待つ口。既定は setTimeout。 */
  readonly sleep?: (ms: number) => Promise<void>
  /** 1 回の要求の打ち切り。既定 180 秒。 */
  readonly timeoutMs?: number
}

/** 「500ms」「768.49ms」（ミリ秒だけ）。分の「m」と取り違えないよう先に見る。 */
const RETRY_IN_MS = /retry in ([\d.]+)ms\b/i
const RETRY_IN = /retry in ((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+s)?)/i

/** 429 の返答の本文から、待つ秒数（余裕の 2 秒は足さない）。見つからなければ null。 */
export const parseRetryDelaySec = (body: string): number | null => {
  const head = body.slice(0, BODY_SCAN_CHARS)
  const ms = RETRY_IN_MS.exec(head)?.[1]
  if (ms !== undefined) {
    const value = Number.parseFloat(ms)
    return Number.isFinite(value) ? value / 1000 : null
  }
  const found = RETRY_IN.exec(head)?.[1]
  if (found === undefined || found === '') return null
  const part = (unit: string): number => Number.parseFloat(new RegExp(`([\\d.]+)${unit}(?!s)`).exec(found)?.[1] ?? '0')
  return part('h') * 3600 + part('m') * 60 + part('s')
}

/** 「約 19 時間 22 分」「約 2 分」「約 48 秒」。 */
const humanWait = (sec: number): string => {
  if (sec >= 3600) return `約 ${Math.floor(sec / 3600)} 時間 ${Math.floor((sec % 3600) / 60)} 分`
  if (sec >= 60) return `約 ${Math.ceil(sec / 60)} 分`
  return `約 ${Math.ceil(sec)} 秒`
}

const tooLongWait = (sec: number): VoiceProviderError =>
  new VoiceProviderError(
    'rate_limited',
    `${WHO} の回数の上限に達しました。もう一度頼めるまで${humanWait(sec)}待つ必要があるため止めました（無料枠は 1 日の回数に上限があります）`,
    false,
  )

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 1 回送る。打ち切りと、呼び出し側の取り消しを見分ける。 */
const sendOnce = async (deps: GeminiRequestDeps, url: string, body: string, signal: AbortSignal | undefined): Promise<Response> => {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), deps.timeoutMs ?? GEMINI_TIMEOUT_MS)
  const combined = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal])
  try {
    return await deps.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': deps.apiKey },
      body,
      signal: combined,
    })
  } catch (cause) {
    if (signal?.aborted === true) throw new VoiceProviderError('cancelled', `${WHO} への依頼を止めました`, false)
    if (timeout.signal.aborted) {
      throw new VoiceProviderError('unavailable', `${WHO} が ${Math.round((deps.timeoutMs ?? GEMINI_TIMEOUT_MS) / 1000)} 秒で応答しませんでした。時間を置いてやり直してください`, true)
    }
    const reason = cause instanceof Error ? cause.name : 'unknown'
    throw new VoiceProviderError('unavailable', `${WHO} に繋がりませんでした（${reason}）。ネットワークを確かめてください`, true)
  } finally {
    clearTimeout(timer)
  }
}

type Tries = { readonly rateLimited: number; readonly serverErrors: number }

/** 送り直しながら、成功の応答を得る。 */
const sendWithRetry = async (
  deps: GeminiRequestDeps,
  url: string,
  body: string,
  signal: AbortSignal | undefined,
  tries: Tries,
): Promise<Response> => {
  const sleep = deps.sleep ?? defaultSleep
  const response = await sendOnce(deps, url, body, signal)
  if (response.ok) return response
  if (response.status === 429) {
    if (tries.rateLimited >= GEMINI_MAX_RATE_LIMIT_RETRIES) throw voiceFailureFromStatus(WHO, 429)
    const text = await response.text().catch(() => '')
    const waitSec = (parseRetryDelaySec(text) ?? DEFAULT_RATE_LIMIT_SEC) + RATE_LIMIT_MARGIN_SEC
    if (waitSec > GEMINI_MAX_RATE_LIMIT_WAIT_SEC) throw tooLongWait(waitSec)
    await sleep(waitSec * 1000)
    return sendWithRetry(deps, url, body, signal, { ...tries, rateLimited: tries.rateLimited + 1 })
  }
  const serverWait = GEMINI_SERVER_RETRY_WAITS_SEC[tries.serverErrors]
  if (response.status >= 500 && serverWait !== undefined) {
    await sleep(serverWait * 1000)
    return sendWithRetry(deps, url, body, signal, { ...tries, serverErrors: tries.serverErrors + 1 })
  }
  throw voiceFailureFromStatus(WHO, response.status)
}

/** JSON を送り、JSON を受け取って形を確かめる（待って送り直す）。 */
export const geminiPostJson = async <T>(
  deps: GeminiRequestDeps,
  url: string,
  payload: unknown,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> => {
  const response = await sendWithRetry(deps, url, JSON.stringify(payload), signal, { rateLimited: 0, serverErrors: 0 })
  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw badResponse(WHO)
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw badResponse(WHO)
  return parsed.data
}
