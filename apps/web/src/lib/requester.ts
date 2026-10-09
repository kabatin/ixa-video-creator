import type { z } from 'zod'
import { ensureOk, joinUrl, jsonHeaders, send, unwrap } from '@/lib/http'

/**
 * `baseUrl` に束ねた HTTP メソッド。
 * 封筒の剥がし方とエラー文脈の付け方を 1 箇所に集約し、
 * 各 API モジュール（プロジェクト / Shot / Character / アップロード）から共有する。
 */

/** 封筒の中身を検証するスキーマ。入力は `unknown` として扱う。 */
export type WireSchema<T> = z.ZodType<T, z.ZodTypeDef, unknown>

export type Requester = {
  readonly baseUrl: string
  readonly get: <T>(path: string, schema: WireSchema<T>) => Promise<T>
  /** 404 を「存在しない」として null に畳む。それ以外の失敗は throw する。 */
  readonly getOrNull: <T>(path: string, schema: WireSchema<T>) => Promise<T | null>
  /** `body` が undefined のときは本文を送らない（本文を取らない POST がある）。 */
  readonly post: <T>(path: string, body: unknown, schema: WireSchema<T>) => Promise<T>
  readonly patch: <T>(path: string, body: unknown, schema: WireSchema<T>) => Promise<T>
  /** 全体を置き換える。部分更新の PATCH と混同しないこと。 */
  readonly put: <T>(path: string, body: unknown, schema: WireSchema<T>) => Promise<T>
  /** 204 は本文が無いため封筒を剥がさない。失敗だけを例外にする。 */
  readonly remove: (path: string) => Promise<void>
}

export type RequesterOptions = {
  /** Next のサーバ側から呼ぶときのクッキー（ブラウザの中では要らない。ブラウザが付ける）。 */
  readonly cookie?: string
}

export const createRequester = (baseUrl: string, options: RequesterOptions = {}): Requester => {
  const headers: Readonly<Record<string, string>> =
    options.cookie === undefined || options.cookie === '' ? jsonHeaders : { ...jsonHeaders, cookie: options.cookie }
  const initFor = (method: string, body: unknown): RequestInit =>
    body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) }

  const call = async <T>(
    method: string,
    path: string,
    body: unknown,
    schema: WireSchema<T>,
  ): Promise<T> => {
    const url = joinUrl(baseUrl, path)
    const context = `${method} ${url}`
    const raw = await send(url, initFor(method, body))
    ensureOk(raw, context)
    return unwrap(schema, raw, context)
  }

  return {
    baseUrl,

    get: (path, schema) => call('GET', path, undefined, schema),

    getOrNull: async (path, schema) => {
      const url = joinUrl(baseUrl, path)
      const context = `GET ${url}`
      const raw = await send(url, { method: 'GET', headers })
      if (raw.status === 404) return null
      ensureOk(raw, context)
      return unwrap(schema, raw, context)
    },

    post: (path, body, schema) => call('POST', path, body, schema),

    patch: (path, body, schema) => call('PATCH', path, body, schema),

    put: (path, body, schema) => call('PUT', path, body, schema),

    remove: async (path) => {
      const url = joinUrl(baseUrl, path)
      const raw = await send(url, { method: 'DELETE', headers })
      ensureOk(raw, `DELETE ${url}`)
    },
  }
}
