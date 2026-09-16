import {
  CreateProjectInput,
  type MediaAssetId,
  type Project,
  type ProjectId,
  type Shot,
  type ShotId,
  type Take,
  type TakeId,
} from '@ixa/domain'
import {
  CreateShotBody,
  GenerateTakesBody,
  UpdateShotBody,
  WireGenerateResult,
  WireProject,
  WireProjectList,
  WireShot,
  WireShotList,
  WireSignedUrl,
  WireTakeList,
} from '@/lib/api-schemas'
import type { z } from 'zod'
import { ensureOk, joinUrl, jsonHeaders, send, unwrap } from '@/lib/http'

/** 封筒の中身を検証するスキーマ。入力は `unknown` として扱う。 */
type WireSchema<T> = z.ZodType<T, z.ZodTypeDef, unknown>

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
  listShots: (projectId: ProjectId) => Promise<Shot[]>
  createShot: (projectId: ProjectId, input: CreateShotBody) => Promise<Shot>
  updateShot: (id: ShotId, patch: UpdateShotBody) => Promise<Shot>
  deleteShot: (id: ShotId) => Promise<void>
  generateTakes: (shotId: ShotId, input: GenerateTakesBody) => Promise<WireGenerateResult>
  listTakes: (shotId: ShotId) => Promise<Take[]>
  selectTake: (shotId: ShotId, takeId: TakeId) => Promise<Shot>
  mediaUrl: (mediaAssetId: MediaAssetId) => Promise<WireSignedUrl>
}

const shotPath = (id: ShotId, suffix = ''): string => `/shots/${encodeURIComponent(id)}${suffix}`

export const createApiClient = (baseUrl: string = resolveApiBaseUrl()): ApiClient => {
  const get = async <T>(path: string, schema: WireSchema<T>): Promise<T> => {
    const url = joinUrl(baseUrl, path)
    const context = `GET ${url}`
    const raw = await send(url, { method: 'GET', headers: jsonHeaders })
    ensureOk(raw, context)
    return unwrap(schema, raw, context)
  }

  const post = async <T>(path: string, body: unknown, schema: WireSchema<T>): Promise<T> => {
    const url = joinUrl(baseUrl, path)
    const context = `POST ${url}`
    const raw = await send(url, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    })
    ensureOk(raw, context)
    return unwrap(schema, raw, context)
  }

  return {
    baseUrl,

    listProjects: async (workspaceId: string): Promise<Project[]> => {
      const query = new URLSearchParams({ workspaceId })
      return get(`/projects?${query.toString()}`, WireProjectList)
    },

    getProject: async (id: string): Promise<Project | null> => {
      const url = joinUrl(baseUrl, `/projects/${encodeURIComponent(id)}`)
      const context = `GET ${url}`
      const raw = await send(url, { method: 'GET', headers: jsonHeaders })
      if (raw.status === 404) return null
      ensureOk(raw, context)
      return unwrap(WireProject, raw, context)
    },

    createProject: async (input: CreateProjectInput): Promise<Project> =>
      post('/projects', CreateProjectInput.parse(input), WireProject),

    listShots: async (projectId: ProjectId): Promise<Shot[]> =>
      get(`/projects/${encodeURIComponent(projectId)}/shots`, WireShotList),

    createShot: async (projectId: ProjectId, input: CreateShotBody): Promise<Shot> =>
      post(
        `/projects/${encodeURIComponent(projectId)}/shots`,
        CreateShotBody.parse(input),
        WireShot,
      ),

    updateShot: async (id: ShotId, patch: UpdateShotBody): Promise<Shot> => {
      const url = joinUrl(baseUrl, shotPath(id))
      const context = `PATCH ${url}`
      const raw = await send(url, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify(UpdateShotBody.parse(patch)),
      })
      ensureOk(raw, context)
      return unwrap(WireShot, raw, context)
    },

    deleteShot: async (id: ShotId): Promise<void> => {
      const url = joinUrl(baseUrl, shotPath(id))
      const raw = await send(url, { method: 'DELETE', headers: jsonHeaders })
      // 204 は本文が無いため封筒を剥がさない。失敗だけを例外にする。
      ensureOk(raw, `DELETE ${url}`)
    },

    generateTakes: async (shotId: ShotId, input: GenerateTakesBody): Promise<WireGenerateResult> =>
      post(shotPath(shotId, '/generate'), GenerateTakesBody.parse(input), WireGenerateResult),

    listTakes: async (shotId: ShotId): Promise<Take[]> =>
      get(shotPath(shotId, '/takes'), WireTakeList),

    selectTake: async (shotId: ShotId, takeId: TakeId): Promise<Shot> =>
      post(shotPath(shotId, '/select-take'), { takeId }, WireShot),

    mediaUrl: async (mediaAssetId: MediaAssetId): Promise<WireSignedUrl> =>
      get(`/media/${encodeURIComponent(mediaAssetId)}/url`, WireSignedUrl),
  }
}
