import { z } from 'zod'

/**
 * ixa の API を呼ぶ口。応答は `{ success, data }` / `{ success: false, error, fields? }`（docs/ARCHITECTURE.md §18）。
 *
 * - 鍵は `Authorization: Bearer` に載せるだけ。**例外の文・ログ・結果には一切出さない。**
 * - 署名付き URL（`/files/*` やストレージ）には**鍵を送らない**。URL そのものが鍵で、
 *   置き場が別のホストなら鍵をよそへ渡すことになる。
 * - 応答の `data` は呼ぶ側が渡した zod で検証する（規約 4）。
 */

export type FieldErrors = Readonly<Record<string, readonly string[]>>

/** API が返した失敗。`message` は API の文（日本語）のまま。 */
export class IxaApiError extends Error {
  constructor(
    readonly status: number,
    readonly apiMessage: string,
    readonly fields: FieldErrors | null,
    /** 失敗応答の本文（409 の `duplicateOf` などを読むため）。 */
    readonly body: unknown,
    readonly method: string,
    readonly path: string,
  ) {
    super(`${method} ${path} → ${String(status)}: ${apiMessage}`)
    this.name = 'IxaApiError'
  }
}

/** API に届かなかった（起動していない・宛先違い）。 */
export class IxaUnreachableError extends Error {
  constructor(
    readonly baseUrl: string,
    options?: { cause?: unknown },
  ) {
    super(`ixa の API（${baseUrl}）に届きませんでした。pnpm dev で起動しているか、IXA_API_URL を確かめてください`, options)
    this.name = 'IxaUnreachableError'
  }
}

/** 署名付き URL の置き場に届かなかった。 */
export class StorageUnreachableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('保存先に届きませんでした（素材の置き場が止まっているか、置き場の URL の設定が違います）', options)
    this.name = 'StorageUnreachableError'
  }
}

const ErrorEnvelope = z.object({
  success: z.literal(false),
  error: z.string(),
  fields: z.record(z.string(), z.array(z.string())).optional(),
})

const SuccessEnvelope = z.object({ success: z.literal(true), data: z.unknown() })

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type ApiClientConfig = {
  readonly baseUrl: string
  readonly token: string
  readonly fetch: FetchLike
}

export type Query = Readonly<Record<string, string | number | boolean | undefined>>

export type RequestOptions = {
  readonly body?: unknown
  readonly query?: Query
}

export type ApiClient = {
  readonly baseUrl: string
  readonly request: <T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options?: RequestOptions,
  ) => Promise<T>
  readonly get: <T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, query?: Query) => Promise<T>
  readonly post: <T>(path: string, body: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>) => Promise<T>
  /** 署名付き URL から本体を取る（鍵は送らない）。相対 URL は API の起点で解決する。 */
  readonly download: (signedUrl: string) => Promise<Response>
  /** 署名付き URL へ本体を置く（鍵は送らない）。 */
  readonly upload: (signedUrl: string, bytes: Uint8Array, contentType: string) => Promise<void>
}

const withQuery = (path: string, query: Query | undefined): string => {
  if (query === undefined) return path
  const entries = Object.entries(query).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, String(value)] as [string, string]],
  )
  return entries.length === 0 ? path : `${path}?${new URLSearchParams(entries).toString()}`
}

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

const toApiError = (status: number, body: unknown, method: string, path: string): IxaApiError => {
  const parsed = ErrorEnvelope.safeParse(body)
  if (parsed.success) {
    return new IxaApiError(status, parsed.data.error, parsed.data.fields ?? null, body, method, path)
  }
  return new IxaApiError(status, `HTTP ${String(status)}（本文を読めませんでした）`, null, body, method, path)
}

export const createApiClient = (config: ApiClientConfig): ApiClient => {
  const resolve = (url: string): string => (url.startsWith('/') ? `${config.baseUrl}${url}` : url)

  /** API へ。届かなければ API の起点を添えて知らせる（起点は鍵ではない）。 */
  const callApi = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await config.fetch(url, init)
    } catch (error) {
      throw new IxaUnreachableError(config.baseUrl, { cause: error })
    }
  }

  /**
   * 署名付き URL（置き場）へ。**文に URL を載せない**（署名そのものが鍵）。原因は cause に残す。
   * API とは別のホストのことがあるので、API に届かない文とは分ける。
   */
  const callStorage = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await config.fetch(url, init)
    } catch (error) {
      throw new StorageUnreachableError({ cause: error })
    }
  }

  const request: ApiClient['request'] = async (method, path, schema, options = {}) => {
    const hasBody = options.body !== undefined
    const headers: Readonly<Record<string, string>> = {
      accept: 'application/json',
      authorization: `Bearer ${config.token}`,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    }
    const response = await callApi(`${config.baseUrl}${withQuery(path, options.query)}`, {
      method,
      headers,
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    })
    const body = await readJson(response)
    if (!response.ok) throw toApiError(response.status, body, method, path)
    // 本文なし（削除など）。呼ぶ側は z.unknown() / z.undefined() を渡す。
    if (response.status === 204) return schema.parse(undefined)
    const envelope = SuccessEnvelope.safeParse(body)
    if (!envelope.success) {
      throw new Error(`${method} ${path}: 応答が { success: true, data } の形ではありません`)
    }
    const data = schema.safeParse(envelope.data.data)
    if (!data.success) {
      const issues = data.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`)
      throw new Error(`${method} ${path}: 応答の形が想定と違います — ${issues.join(' / ')}`)
    }
    return data.data
  }

  return {
    baseUrl: config.baseUrl,
    request,
    get: (path, schema, query) => request('GET', path, schema, query === undefined ? {} : { query }),
    post: (path, body, schema) => request('POST', path, schema, { body }),
    download: async (signedUrl) => {
      const response = await callStorage(resolve(signedUrl), { method: 'GET' })
      // 本文は読まない（ストレージの失敗応答は署名の一部を反射することがある）。
      if (!response.ok) throw new Error(`素材を取り出せませんでした（${String(response.status)}）`)
      return response
    },
    upload: async (signedUrl, bytes, contentType) => {
      const response = await callStorage(resolve(signedUrl), {
        method: 'PUT',
        headers: { 'content-type': contentType },
        body: bytes,
      })
      if (!response.ok) throw new Error(`保存先が受け取りませんでした（${String(response.status)}）`)
    },
  }
}

/** パスの 1 区切りを安全に埋め込む。 */
export const seg = (value: string): string => encodeURIComponent(value)
