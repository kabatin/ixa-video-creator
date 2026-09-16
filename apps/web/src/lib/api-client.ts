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
import { createCharacterApi, type CharacterApi } from '@/lib/character-api'
import { createRequester } from '@/lib/requester'
import { createUploadApi, type UploadApi } from '@/lib/upload-api'

/** docs/ARCHITECTURE.md §18 のレスポンス形。 */
export type ApiResponse<T> = { success: boolean; data?: T; error?: string }

export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3001'

export const resolveApiBaseUrl = (): string =>
  process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_BASE_URL

export type ProjectApi = {
  listProjects: (workspaceId: string) => Promise<Project[]>
  getProject: (id: string) => Promise<Project | null>
  createProject: (input: CreateProjectInput) => Promise<Project>
  listShots: (projectId: ProjectId) => Promise<Shot[]>
  /** Shot を 1 件取得する。生成中の状態を追うのに使う。 */
  getShot: (id: ShotId) => Promise<Shot>
  createShot: (projectId: ProjectId, input: CreateShotBody) => Promise<Shot>
  updateShot: (id: ShotId, patch: UpdateShotBody) => Promise<Shot>
  deleteShot: (id: ShotId) => Promise<void>
  generateTakes: (shotId: ShotId, input: GenerateTakesBody) => Promise<WireGenerateResult>
  listTakes: (shotId: ShotId) => Promise<Take[]>
  selectTake: (shotId: ShotId, takeId: TakeId) => Promise<Shot>
  mediaUrl: (mediaAssetId: MediaAssetId) => Promise<WireSignedUrl>
}

export type ApiClient = { readonly baseUrl: string } & ProjectApi & CharacterApi & UploadApi

const shotPath = (id: ShotId, suffix = ''): string => `/shots/${encodeURIComponent(id)}${suffix}`

export const createApiClient = (baseUrl: string = resolveApiBaseUrl()): ApiClient => {
  const requester = createRequester(baseUrl)

  const projectApi: ProjectApi = {
    listProjects: async (workspaceId: string): Promise<Project[]> => {
      const query = new URLSearchParams({ workspaceId })
      return requester.get(`/projects?${query.toString()}`, WireProjectList)
    },

    getProject: async (id: string): Promise<Project | null> =>
      requester.getOrNull(`/projects/${encodeURIComponent(id)}`, WireProject),

    createProject: async (input: CreateProjectInput): Promise<Project> =>
      requester.post('/projects', CreateProjectInput.parse(input), WireProject),

    listShots: async (projectId: ProjectId): Promise<Shot[]> =>
      requester.get(`/projects/${encodeURIComponent(projectId)}/shots`, WireShotList),

    getShot: async (id: ShotId): Promise<Shot> => requester.get(shotPath(id), WireShot),

    createShot: async (projectId: ProjectId, input: CreateShotBody): Promise<Shot> =>
      requester.post(
        `/projects/${encodeURIComponent(projectId)}/shots`,
        CreateShotBody.parse(input),
        WireShot,
      ),

    updateShot: async (id: ShotId, patch: UpdateShotBody): Promise<Shot> =>
      requester.patch(shotPath(id), UpdateShotBody.parse(patch), WireShot),

    deleteShot: async (id: ShotId): Promise<void> => requester.remove(shotPath(id)),

    generateTakes: async (shotId: ShotId, input: GenerateTakesBody): Promise<WireGenerateResult> =>
      requester.post(
        shotPath(shotId, '/generate'),
        GenerateTakesBody.parse(input),
        WireGenerateResult,
      ),

    listTakes: async (shotId: ShotId): Promise<Take[]> =>
      requester.get(shotPath(shotId, '/takes'), WireTakeList),

    selectTake: async (shotId: ShotId, takeId: TakeId): Promise<Shot> =>
      requester.post(shotPath(shotId, '/select-take'), { takeId }, WireShot),

    mediaUrl: async (mediaAssetId: MediaAssetId): Promise<WireSignedUrl> =>
      requester.get(`/media/${encodeURIComponent(mediaAssetId)}/url`, WireSignedUrl),
  }

  return {
    baseUrl,
    ...projectApi,
    ...createCharacterApi(requester),
    ...createUploadApi(requester),
  }
}
