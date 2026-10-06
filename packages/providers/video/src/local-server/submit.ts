import { ProviderBusyError } from '@ixa/provider-core'
import { z } from 'zod'
import { formatIssues } from '../common/reason.js'
import { LocalServerHealth, LocalServerSubmitResponse, type LocalServerJobId } from './api.js'
import {
  localServerInvalidResponseCode,
  localServerNoResponseCode,
  type LocalServerIdentity,
} from './identity.js'
import {
  localServerErrorFor,
  localServerRequest,
  LocalServerRequestError,
  retryAfterMsFrom,
  type LocalServerHttp,
} from './http.js'

/**
 * 投入の口（ADR-0031 / 0040）。満杯と「届いたか分からない」を、失敗ではなく `ProviderBusyError` で知らせる。
 */

/**
 * 冪等キーの形（契約: 1〜128 文字の `[A-Za-z0-9._:-]`）。
 * worker は GenerationJob の ID（ULID）を渡すので必ず収まる。収まらないのは配線の誤り。
 */
export const LocalServerIdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)

export const idempotencyKeyOf = (
  identity: LocalServerIdentity,
  key: string | undefined,
): string | null => {
  if (key === undefined) return null
  const parsed = LocalServerIdempotencyKey.safeParse(key)
  if (!parsed.success) {
    throw new LocalServerRequestError(
      identity.providerId,
      `${identity.codePrefix}_invalid_idempotency_key`,
      `${identity.label}の冪等キーの形が違います（1〜128 文字の英数字と . _ : -）`,
      false,
      null,
    )
  }
  return parsed.data
}

/**
 * 空きが無いときに次に試すまでの目安。走っている 1 本は数分〜数十分かかるので、
 * 数十秒ごとに確かめても空かない。worker はこれを 30 秒〜10 分に収めて使う。
 */
export const LOCAL_SERVER_FULL_RETRY_AFTER_MS = 120_000

const busy = (
  identity: LocalServerIdentity,
  message: string,
  retryAfterMs: number | null,
  cause?: unknown,
): ProviderBusyError =>
  new ProviderBusyError(
    message,
    identity.providerId,
    retryAfterMs,
    cause === undefined ? undefined : { cause },
  )

const fullMessage = (identity: LocalServerIdentity): string =>
  `${identity.label}が混んでいます（1 本ずつ作っています）`

/**
 * 空きの確認に掛ける上限（PR #4 レビュー #3）。答えないサーバに 1 回の HTTP の上限（60 秒）まで付き合うと、
 * 同じキューの fal やスタブの生成まで分単位で待たされる。確認は節約のためでしかないので短く切る。
 */
export const LOCAL_SERVER_HEALTH_TIMEOUT_MS = 5_000

/**
 * サーバのエラー（5xx）で投げ直す回数と間（PR #4 レビュー #1）。**満杯ではない**ので待ち行列には回さない。
 * 続けば向こうの不調なので、サーバの理由を付けて失敗にする（12 時間回して「順番が来なかった」と言わない）。
 */
export const LOCAL_SERVER_SERVER_ERROR_ATTEMPTS = 3
export const LOCAL_SERVER_SERVER_ERROR_RETRY_MS = 2_000

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms))

/** 走っている 1 本と待ちの枠がすべて埋まっているか。 */
export const isFull = (health: LocalServerHealth): boolean =>
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
  http: LocalServerHttp,
  timeoutMs: number = LOCAL_SERVER_HEALTH_TIMEOUT_MS,
): Promise<void> => {
  const { identity } = http
  const quick: LocalServerHttp = { ...http, timeoutMs: Math.min(http.timeoutMs, timeoutMs) }
  const response = await localServerRequest(quick, 'GET', '/v1/health').catch((error: unknown) => {
    // 応答が返らなかっただけなら、何も積んでいないので後で試せばよい。
    if (
      error instanceof LocalServerRequestError &&
      error.code === localServerNoResponseCode(identity)
    ) {
      throw busy(identity, error.message, null, error)
    }
    throw error
  })
  if (!response.ok) return
  const health = LocalServerHealth.safeParse(response.body)
  if (health.success && isFull(health.data)) {
    throw busy(identity, fullMessage(identity), LOCAL_SERVER_FULL_RETRY_AFTER_MS)
  }
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
  http: LocalServerHttp,
  body: object,
  idempotencyKey: string | null,
  retryDelayMs: number = LOCAL_SERVER_SERVER_ERROR_RETRY_MS,
): Promise<LocalServerJobId> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await postJobOnce(http, body, idempotencyKey)
    } catch (error) {
      const again =
        idempotencyKey !== null &&
        attempt < LOCAL_SERVER_SERVER_ERROR_ATTEMPTS &&
        error instanceof LocalServerRequestError &&
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
  http: LocalServerHttp,
  body: object,
  idempotencyKey: string | null,
): Promise<LocalServerJobId> => {
  const { identity } = http
  const headers: Record<string, string> =
    idempotencyKey === null ? {} : { 'Idempotency-Key': idempotencyKey }
  const response = await localServerRequest(
    http,
    'POST',
    `/v1/workflows/${identity.workflowId}/jobs`,
    body,
    headers,
  ).catch((error: unknown) => {
    if (
      idempotencyKey !== null &&
      error instanceof LocalServerRequestError &&
      error.code === localServerNoResponseCode(identity)
    ) {
      throw busy(
        identity,
        `${identity.label}へ投入した応答が返りませんでした。同じ投入をやり直します`,
        null,
        error,
      )
    }
    throw error
  })

  if (response.status === 429) {
    // 何も積まれていない。失敗ではなく「後で来て」（ADR-0031）。
    throw busy(identity, fullMessage(identity), retryAfterMsFrom(response.headers))
  }
  if (!response.ok) {
    const error = localServerErrorFor(identity, response.status, response.body, '投入')
    // 同じキーの投入がまだ処理中（409 idempotency_in_flight）は、キーがあれば同じ投入を後で投げ直す。
    // 409 idempotency_conflict（同じキーで中身が違う）はやり直せないので、ここを通らず終端になる。
    // 5xx は満杯ではない。`postJob` がその場で数回だけ投げ直す。
    if (idempotencyKey !== null && error.retryable && response.status < 500) {
      throw busy(identity, error.message, retryAfterMsFrom(response.headers), error)
    }
    throw error
  }

  const parsed = LocalServerSubmitResponse.safeParse(response.body)
  if (!parsed.success) {
    throw new LocalServerRequestError(
      identity.providerId,
      localServerInvalidResponseCode(identity),
      `${identity.label}の投入応答が仕様と違います: ${formatIssues(parsed.error)}`,
      false,
      response.status,
    )
  }
  return parsed.data.id
}
