import {
  BrandAsset,
  CreateBrandAssetInput,
  CreateLocationInput,
  Location,
  UpdateBrandAssetPatch,
  UpdateLocationPatch,
  UpdateProjectPatch,
  type BrandAssetId,
  type LocationId,
  type Project,
  type ProjectId,
} from '@ixa/domain'
import { z } from 'zod'
import { WireProject } from '@/lib/api-schemas'
import { ApiError } from '@/lib/api-error'
import { createLocationApi, type LocationApi } from '@/lib/location-api'
import { createRequester, type Requester } from '@/lib/requester'

/**
 * 素材ライブラリ（DOMAIN.md §6）と Project 設定の呼び出し口。
 *
 * `location-api.ts` は一覧取得だけを持つ。**そこへ CRUD を足さず、ここに分けている**のは
 * Shot フォームが必要とする読み取りと、ライブラリ画面だけが必要とする書き込みを
 * 混ぜないため。一覧は `createLocationApi` を再輸出して 1 実装に保つ。
 *
 * **検証規則をここへ書き写さないこと（lessons L-016）。** BrandAsset の
 * 「color なら value が #RRGGBB」「それ以外は mediaAssetId が必須」は
 * `apps/api/src/routes/assets.ts` の `brandAssetFieldErrors` が唯一の正で、
 * 違反は 422 と `fields` で返ってくる。画面は `fieldErrorsOf` でそれを読むだけにする。
 */

export const WireBrandAsset = BrandAsset
export const WireBrandAssetList = z.array(WireBrandAsset)

export const WireLocationItem = Location
export const WireLocationItemList = z.array(WireLocationItem)

/**
 * 作成の本文。ブランド資産とロケーションはプロジェクトごと（ADR-0034）で、プロジェクトは経路が持ち、
 * ワークスペースはサーバがそのプロジェクトから引く。
 */
export const CreateBrandAssetBody = CreateBrandAssetInput.omit({ workspaceId: true, projectId: true })
export type CreateBrandAssetBody = z.input<typeof CreateBrandAssetBody>
export const CreateLocationBody = CreateLocationInput.omit({ workspaceId: true, projectId: true })
export type CreateLocationBody = z.input<typeof CreateLocationBody>

export type LibraryApi = {
  listBrandAssets: (projectId: ProjectId) => Promise<BrandAsset[]>
  createBrandAsset: (projectId: ProjectId, input: CreateBrandAssetBody) => Promise<BrandAsset>
  updateBrandAsset: (id: BrandAssetId, patch: UpdateBrandAssetPatch) => Promise<BrandAsset>
  deleteBrandAsset: (id: BrandAssetId) => Promise<void>
  createLocation: (projectId: ProjectId, input: CreateLocationBody) => Promise<Location>
  updateLocation: (id: LocationId, patch: UpdateLocationPatch) => Promise<Location>
  deleteLocation: (id: LocationId) => Promise<void>
}

/**
 * Project の設定変更。`api-client.ts` には作成と取得しか無く、
 * **作ったあと名前も尺も予算も変えられない**状態だったため足す。
 */
export type ProjectSettingsApi = {
  updateProject: (id: ProjectId, patch: UpdateProjectPatch) => Promise<Project>
  /** ソフトデリート。Shot も Take も辿れなくなる。 */
  deleteProject: (id: ProjectId) => Promise<void>
}

const brandAssetPath = (id: BrandAssetId): string => `/brand-assets/${encodeURIComponent(id)}`
const locationPath = (id: LocationId): string => `/locations/${encodeURIComponent(id)}`
const projectPath = (id: ProjectId): string => `/projects/${encodeURIComponent(id)}`

export const createLibraryApi = (requester: Requester): LibraryApi => ({
  listBrandAssets: async (projectId) =>
    requester.get(`${projectPath(projectId)}/brand-assets`, WireBrandAssetList),

  createBrandAsset: async (projectId, input) =>
    requester.post(`${projectPath(projectId)}/brand-assets`, CreateBrandAssetBody.parse(input), WireBrandAsset),

  updateBrandAsset: async (id, patch) =>
    requester.patch(brandAssetPath(id), UpdateBrandAssetPatch.parse(patch), WireBrandAsset),

  deleteBrandAsset: async (id) => requester.remove(brandAssetPath(id)),

  createLocation: async (projectId, input) =>
    requester.post(`${projectPath(projectId)}/locations`, CreateLocationBody.parse(input), WireLocationItem),

  updateLocation: async (id, patch) =>
    requester.patch(locationPath(id), UpdateLocationPatch.parse(patch), WireLocationItem),

  deleteLocation: async (id) => requester.remove(locationPath(id)),
})

export const createProjectSettingsApi = (requester: Requester): ProjectSettingsApi => ({
  updateProject: async (id, patch) =>
    requester.patch(projectPath(id), UpdateProjectPatch.parse(patch), WireProject),

  deleteProject: async (id) => requester.remove(projectPath(id)),
})

export type LibraryClient = LibraryApi & ProjectSettingsApi & LocationApi

/**
 * 画面が使う束。
 *
 * **暫定の入口。** `createApiClient()` へ配線されるまでの間、ここから直接組む。
 * 配線後は `createApiClient()` に同じメソッドが生えるので、この関数は消せる。
 * `api-client.ts` を import しないのは、配線後に循環参照になるのを避けるため。
 */
export const createLibraryClient = (baseUrl: string): LibraryClient => {
  const requester = createRequester(baseUrl)
  return {
    ...createLocationApi(requester),
    ...createLibraryApi(requester),
    ...createProjectSettingsApi(requester),
  }
}

/** API のエラー応答。`fields` はフィールド名 → メッセージの一覧（apps/api/src/response.ts）。 */
const WireErrorBody = z.object({
  success: z.literal(false),
  error: z.string(),
  fields: z.record(z.string(), z.array(z.string())).optional(),
})

export type ServerFieldErrors = Readonly<Record<string, string>>

/**
 * サーバが返したフィールド単位の検証エラーを取り出す。
 *
 * **画面側で同じ規則を再実装しないための口**（lessons L-016）。
 * 該当しない失敗（通信断・500・fields 無し）は null を返し、
 * 呼び出し側がまとめて 1 件のエラーとして出す。
 */
export const fieldErrorsOf = (error: unknown): ServerFieldErrors | null => {
  if (!(error instanceof ApiError) || error.body === '') return null

  const parsed = ((): unknown => {
    try {
      return JSON.parse(error.body) as unknown
    } catch {
      // 本文が JSON でないなら、フィールド単位の情報は最初から無い。
      return null
    }
  })()

  const body = WireErrorBody.safeParse(parsed)
  if (!body.success || body.data.fields === undefined) return null

  const entries = Object.entries(body.data.fields).flatMap(([field, messages]) =>
    messages.length === 0 ? [] : [[field, messages.join(' / ')] as const],
  )
  return entries.length === 0 ? null : Object.freeze(Object.fromEntries(entries))
}
