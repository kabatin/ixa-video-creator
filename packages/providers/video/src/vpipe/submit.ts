import { ProviderBusyError, ProviderError } from '@ixa/provider-core'
import { z } from 'zod'
import { formatIssues } from '../common/reason.js'
import { VpipeHealth, VpipeSubmitResponse, type VpipeJobId } from './api.js'
import { VPIPE_PROVIDER_ID, VPIPE_WORKFLOW_ID } from './descriptor.js'
import {
  retryAfterMsFrom,
  VPIPE_LABEL,
  VPIPE_NO_RESPONSE,
  vpipeErrorFor,
  VpipeRequestError,
  vpipeRequest,
  type VpipeHttp,
} from './http.js'
import type { VpipeJobBody } from './request.js'

/**
 * 投入の口（ADR-0031）。満杯と「届いたか分からない」を、失敗ではなく `ProviderBusyError` で知らせる。
 */

/**
 * 冪等キーの形（vpipe-api の契約: 1〜128 文字の `[A-Za-z0-9._:-]`）。
 * worker は GenerationJob の ID（ULID）を渡すので必ず収まる。収まらないのは配線の誤り。
 */
export const VpipeIdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)

export const idempotencyKeyOf = (key: string | undefined): string | null => {
  if (key === undefined) return null
  const parsed = VpipeIdempotencyKey.safeParse(key)
  if (!parsed.success) {
    throw new ProviderError(
      `${VPIPE_LABEL}の冪等キーの形が違います（1〜128 文字の英数字と . _ : -）`,
      VPIPE_PROVIDER_ID,
      false,
    )
  }
  return parsed.data
}

/**
 * 空きが無いときに次に試すまでの目安。走っている 1 本は 7〜25 分かかるので、
 * 数十秒ごとに確かめても空かない。worker はこれを 30 秒〜10 分に収めて使う。
 */
export const VPIPE_FULL_RETRY_AFTER_MS = 120_000

const busy = (message: string, retryAfterMs: number | null, cause?: unknown): ProviderBusyError =>
  new ProviderBusyError(
    message,
    VPIPE_PROVIDER_ID,
    retryAfterMs,
    cause === undefined ? undefined : { cause },
  )

const FULL_MESSAGE = `${VPIPE_LABEL}が混んでいます（1 本ずつ作っています）`

/**
 * 空きの確認に掛ける上限（PR #4 レビュー #3）。答えない vpipe に 1 回の HTTP の上限（60 秒）まで付き合うと、
 * 同じキューの fal やスタブの生成まで分単位で待たされる。確認は節約のためでしかないので短く切る。
 */
export const VPIPE_HEALTH_TIMEOUT_MS = 5_000

/**
 * サーバのエラー（5xx）で投げ直す回数と間（PR #4 レビュー #1）。**満杯ではない**ので待ち行列には回さない。
 * 続けば向こうの不調なので、サーバの理由を付けて失敗にする（12 時間回して「順番が来なかった」と言わない）。
 */
export const VPIPE_SERVER_ERROR_ATTEMPTS = 3
export const VPIPE_SERVER_ERROR_RETRY_MS = 2_000

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms))

/** 走っている 1 本と待ちの枠がすべて埋まっているか。 */
export const isFull = (health: VpipeHealth): boolean =>
  health.running + health.waiting >= 1 + health.max_waiting

/**
 * 投入の前に空きを確かめる。**満杯なら開始画像を取り寄せる前に断る。**
 * 満杯のまま投入を繰り返すと、そのたびに署名付き URL を作り直し、最大 20MB の画像を読んで
 * base64（約 27MB）で送り、429 で捨てられる。
 *
 * これは節約のための確認でしかない。**本当の門番は投入の 429**（確認と投入の間に埋まることはある）。
 * だから確認の応答が読めないときは確かめずに進む。ただしサーバが止まっている（接続できない）なら
 * そのまま投げる（押した人にすぐ知らせる）。
 */
export const ensureCapacity = async (
  http: VpipeHttp,
  timeoutMs: number = VPIPE_HEALTH_TIMEOUT_MS,
): Promise<void> => {
  const quick: VpipeHttp = { ...http, timeoutMs: Math.min(http.timeoutMs, timeoutMs) }
  const response = await vpipeRequest(quick, 'GET', '/v1/health').catch((error: unknown) => {
    // 応答が返らなかっただけなら、何も積んでいないので後で試せばよい。
    if (error instanceof VpipeRequestError && error.code === VPIPE_NO_RESPONSE) {
      throw busy(error.message, null, error)
    }
    throw error
  })
  if (!response.ok) return
  const health = VpipeHealth.safeParse(response.body)
  if (health.success && isFull(health.data)) throw busy(FULL_MESSAGE, VPIPE_FULL_RETRY_AFTER_MS)
}

/**
 * ジョブを投入し、サーバのジョブ ID を返す。
 *
 * - 202（新しいジョブ）と 200（同じ冪等キーの既存ジョブ）は同じ形で受ける
 * - 429（満杯）は `ProviderBusyError`。何も積まれていない
 * - **冪等キーがあるときだけ**、送ったのに応答が失われた・同じキーの投入がまだ処理中も `ProviderBusyError` にする。
 *   サーバが受け付けたかは分からないが、同じキーで投げ直せば同じジョブが返る（二重に生成しない）
 * - **やり直せるサーバのエラー（5xx）は満杯ではない。** キーがあればその場で数回投げ直し、続けば失敗にする
 * - キーが無ければ投げ直しで二重に生成しうるので、どれもそのまま失敗として投げる
 */
export const postJob = async (
  http: VpipeHttp,
  body: VpipeJobBody,
  idempotencyKey: string | null,
  retryDelayMs: number = VPIPE_SERVER_ERROR_RETRY_MS,
): Promise<VpipeJobId> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await postJobOnce(http, body, idempotencyKey)
    } catch (error) {
      const again =
        idempotencyKey !== null &&
        attempt < VPIPE_SERVER_ERROR_ATTEMPTS &&
        error instanceof VpipeRequestError &&
        error.retryable &&
        error.status !== null &&
        error.status >= 500
      if (!again) throw error
      await sleep(retryDelayMs * attempt)
    }
  }
}

/** 1 回だけ投げる。満杯・処理中・応答なしは `ProviderBusyError`、それ以外の失敗はそのまま投げる。 */
const postJobOnce = async (
  http: VpipeHttp,
  body: VpipeJobBody,
  idempotencyKey: string | null,
): Promise<VpipeJobId> => {
  const headers: Record<string, string> =
    idempotencyKey === null ? {} : { 'Idempotency-Key': idempotencyKey }
  const response = await vpipeRequest(
    http,
    'POST',
    `/v1/workflows/${VPIPE_WORKFLOW_ID}/jobs`,
    body,
    headers,
  ).catch((error: unknown) => {
    if (
      idempotencyKey !== null &&
      error instanceof VpipeRequestError &&
      error.code === VPIPE_NO_RESPONSE
    ) {
      throw busy(
        `${VPIPE_LABEL}へ投入した応答が返りませんでした。同じ投入をやり直します`,
        null,
        error,
      )
    }
    throw error
  })

  if (response.status === 429) {
    // 何も積まれていない。失敗ではなく「後で来て」（ADR-0031）。
    throw busy(FULL_MESSAGE, retryAfterMsFrom(response.headers))
  }
  if (!response.ok) {
    const error = vpipeErrorFor(response.status, response.body, '投入')
    // 同じキーの投入がまだ処理中（409 idempotency_in_flight）は、キーがあれば同じ投入を後で投げ直す。
    // 409 idempotency_conflict（同じキーで中身が違う）はやり直せないので、ここを通らず終端になる。
    // 5xx は満杯ではない。`postJob` がその場で数回だけ投げ直す。
    if (idempotencyKey !== null && error.retryable && response.status < 500) {
      throw busy(error.message, retryAfterMsFrom(response.headers), error)
    }
    throw error
  }

  const parsed = VpipeSubmitResponse.safeParse(response.body)
  if (!parsed.success) {
    throw new VpipeRequestError(
      'vpipe_invalid_response',
      `${VPIPE_LABEL}の投入応答が仕様と違います: ${formatIssues(parsed.error)}`,
      false,
      response.status,
    )
  }
  return parsed.data.id
}
