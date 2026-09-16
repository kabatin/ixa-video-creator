import { CreateProjectInput, type Project } from '@ixa/domain'
import type { z } from 'zod'
import { ApiError, TRANSPORT_ERROR_STATUS, describeError } from '@/lib/api-error'
import { ApiEnvelope, WireProject, WireProjectList } from '@/lib/api-schemas'

/** docs/ARCHITECTURE.md §18 のレスポンス形。 */
export type ApiResponse<T> = { success: boolean; data?: T; error?: string }

export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3001'

export const resolveApiBaseUrl = (): string =>
  process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_BASE_URL

export type ApiClient = {
  readonly baseUrl: string
  listProjects: (workspaceId: string) => Promise<Project[]>
  getProject: (id: string) => Promise<Project | null>
  createProject: (input: CreateProjectInput) => Promise<Project>
}

type RawResponse = {
  readonly status: number
  readonly ok: boolean
  readonly text: string
}

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/u, '')}${path}`

const send = async (url: string, init: RequestInit): Promise<RawResponse> => {
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

const ensureOk = (raw: RawResponse, context: string): void => {
  if (raw.ok) return
  throw new ApiError(
    `${context}: API が ${String(raw.status)} を返しました — ${raw.text.slice(0, 500)}`,
    raw.status,
    raw.text,
  )
}

/** 封筒を剥がし、中身をドメイン由来のスキーマで検証する。検証失敗は zod がそのまま throw する。 */
const unwrap = <T>(
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

const jsonHeaders: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
  accept: 'application/json',
}

export const createApiClient = (baseUrl: string = resolveApiBaseUrl()): ApiClient => ({
  baseUrl,

  listProjects: async (workspaceId: string): Promise<Project[]> => {
    const query = new URLSearchParams({ workspaceId })
    const url = joinUrl(baseUrl, `/projects?${query.toString()}`)
    const context = `GET ${url}`
    const raw = await send(url, { method: 'GET', headers: jsonHeaders })
    ensureOk(raw, context)
    return unwrap(WireProjectList, raw, context)
  },

  getProject: async (id: string): Promise<Project | null> => {
    const url = joinUrl(baseUrl, `/projects/${encodeURIComponent(id)}`)
    const context = `GET ${url}`
    const raw = await send(url, { method: 'GET', headers: jsonHeaders })
    if (raw.status === 404) return null
    ensureOk(raw, context)
    return unwrap(WireProject, raw, context)
  },

  createProject: async (input: CreateProjectInput): Promise<Project> => {
    const url = joinUrl(baseUrl, '/projects')
    const context = `POST ${url}`
    const body = CreateProjectInput.parse(input)
    const raw = await send(url, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    })
    ensureOk(raw, context)
    return unwrap(WireProject, raw, context)
  },
})
