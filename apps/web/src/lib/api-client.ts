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
import { createLocationApi, type LocationApi } from '@/lib/location-api'
import { createMusicApi, type MusicApi } from '@/lib/music-api'
import { createSequenceApi, type SequenceApi } from '@/lib/sequence-api'
import { createReviewApi, type ReviewApi } from '@/lib/review-api'
import { createTimelineApi, type TimelineApi } from '@/lib/timeline-api'
import { createRenderApi, type RenderApi } from '@/lib/render-api'
import { createShotBulkApi, type ShotBulkApi } from '@/lib/shot-bulk-api'
import { createShotCastApi, type ShotCastApi } from '@/lib/shot-cast-api'
import { createCostMeterApi, type CostMeterApi } from '@/lib/cost-meter-api'
import { createShotCompareApi, type ShotCompareApi } from '@/lib/shot-compare-api'
import { createShotPostersApi, type ShotPostersApi } from '@/lib/shot-posters-api'
import {
  createLibraryApi,
  createProjectSettingsApi,
  type LibraryApi,
  type ProjectSettingsApi,
} from '@/lib/library-api'
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
  /**
   * 実体を取りに行くための署名付き URL を**都度発行**する（規約 7。DB には保存しない）。
   *
   * `expiresInSec` は API 側の既定が 300 秒、上限が 3600 秒。
   * **長く画面に留まる用途では必ず明示する。** 音を聴きながら切る画面のように
   * 数十分そこに居る操作では、既定の 5 分を過ぎたあとのシークで
   * ブラウザが期限切れの URL へ範囲リクエストを投げ、再生が黙って止まる。
   */
  mediaUrl: (mediaAssetId: MediaAssetId, expiresInSec?: number) => Promise<WireSignedUrl>
}

export type ApiClient = { readonly baseUrl: string } & ProjectApi &
  CharacterApi &
  LocationApi &
  MusicApi &
  LibraryApi &
  ProjectSettingsApi &
  RenderApi &
  ReviewApi &
  SequenceApi &
  ShotBulkApi &
  ShotCastApi &
  ShotPostersApi &
  ShotCompareApi &
  CostMeterApi &
  TimelineApi &
  UploadApi

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

    mediaUrl: async (mediaAssetId: MediaAssetId, expiresInSec?: number): Promise<WireSignedUrl> => {
      const path = `/media/${encodeURIComponent(mediaAssetId)}/url`
      // 省略時は API 側の既定に任せる。ここで既定値を書き写すと正が 2 つになる。
      if (expiresInSec === undefined) return requester.get(path, WireSignedUrl)
      const query = new URLSearchParams({ expiresInSec: String(expiresInSec) })
      return requester.get(`${path}?${query.toString()}`, WireSignedUrl)
    },
  }

  return {
    baseUrl,
    ...projectApi,
    ...createCharacterApi(requester),
    ...createLocationApi(requester),
    ...createMusicApi(requester),
    ...createReviewApi(requester),
    ...createTimelineApi(requester),
    ...createRenderApi(requester),
    ...createShotBulkApi(requester),
    ...createShotCastApi(requester),
    ...createShotPostersApi(requester),
    ...createShotCompareApi(requester),
    ...createCostMeterApi(requester),
    ...createLibraryApi(requester),
    ...createProjectSettingsApi(requester),
    ...createSequenceApi(requester),
    ...createUploadApi(requester),
  }
}
