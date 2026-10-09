import type { z } from 'zod'
import { ApiError, TRANSPORT_ERROR_STATUS, describeErrorForLog } from '@/lib/api-error'
import { ApiEnvelope } from '@/lib/api-schemas'

/**
 * API クライアントが共有する HTTP プリミティブ。
 * `apps/api` を import せず、ワイヤ形式の知識だけをここに閉じ込める。
 */

export type RawResponse = {
  readonly status: number
  readonly ok: boolean
  readonly text: string
}

export const jsonHeaders: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
  accept: 'application/json',
}

export const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/u, '')}${path}`

/** 入り口の画面。 */
export const LOGIN_PATH = '/login'

/**
 * 鍵が無い・切れたら、ブラウザの中では入り口へ送る（いた場所を `next` に持たせる）。
 * **入る口・出る口そのものへの 401 では送らない**（合言葉のまちがいで画面が飛ぶと、理由が読めない）。
 * Next のサーバ側では何もしない（サーバ側の画面が自分で `redirect` する）。
 */
const sendToLogin = (url: string): void => {
  if (typeof window === 'undefined') return
  if (new URL(url).pathname.startsWith('/auth/')) return
  if (window.location.pathname === LOGIN_PATH) return
  const next = `${window.location.pathname}${window.location.search}`
  window.location.assign(`${LOGIN_PATH}?next=${encodeURIComponent(next)}`)
}

export const send = async (url: string, init: RequestInit): Promise<RawResponse> => {
  const method = init.method ?? 'GET'
  try {
    // クッキーを付けて送る（認証）。画面と API はポートが違うので、既定の same-origin では付かない。
    const response = await fetch(url, { ...init, cache: 'no-store', credentials: 'include' })
    if (response.status === 401) sendToLogin(url)
    return { status: response.status, ok: response.ok, text: await response.text() }
  } catch (cause) {
    throw new ApiError(
      `API に接続できませんでした: ${method} ${url} — ${describeErrorForLog(cause)}`,
      TRANSPORT_ERROR_STATUS,
      '',
      { cause },
    )
  }
}

const parseJson = (text: string, context: string, raw: RawResponse): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch (cause) {
    throw new ApiError(
      `${context}: レスポンスが JSON ではありません`,
      raw.status,
      text,
      { cause },
    )
  }
}

export const ensureOk = (raw: RawResponse, context: string): void => {
  if (raw.ok) return
  throw new ApiError(
    `${context}: API が ${String(raw.status)} を返しました`,
    raw.status,
    raw.text,
  )
}

/** 封筒を剥がし、中身をドメイン由来のスキーマで検証する。検証失敗は zod がそのまま throw する。 */
export const unwrap = <T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  raw: RawResponse,
  context: string,
): T => {
  const envelope = ApiEnvelope.parse(parseJson(raw.text, context, raw))
  if (!envelope.success) {
    throw new ApiError(
      `${context}: API がエラーを返しました`,
      raw.status,
      raw.text,
    )
  }
  return schema.parse(envelope.data)
}
