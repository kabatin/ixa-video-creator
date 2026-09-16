import type { z } from 'zod'
import { ApiError, TRANSPORT_ERROR_STATUS, describeError } from '@/lib/api-error'
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

export const send = async (url: string, init: RequestInit): Promise<RawResponse> => {
  const method = init.method ?? 'GET'
  try {
    const response = await fetch(url, { ...init, cache: 'no-store' })
    return { status: response.status, ok: response.ok, text: await response.text() }
  } catch (cause) {
    throw new ApiError(
      `API に接続できませんでした: ${method} ${url} — ${describeError(cause)}`,
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
      `${context}: レスポンスが JSON ではありません — ${text.slice(0, 200)}`,
      raw.status,
      text,
      { cause },
    )
  }
}

export const ensureOk = (raw: RawResponse, context: string): void => {
  if (raw.ok) return
  throw new ApiError(
    `${context}: API が ${String(raw.status)} を返しました — ${raw.text.slice(0, 500)}`,
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
      `${context}: API がエラーを返しました — ${envelope.error ?? '詳細不明'}`,
      raw.status,
      raw.text,
    )
  }
  return schema.parse(envelope.data)
}
