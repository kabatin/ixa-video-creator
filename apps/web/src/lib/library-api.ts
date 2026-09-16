import {
  BrandAsset,
  BrandCategory,
  CreateBrandAssetInput,
  CreateLocationInput,
  Location,
  UpdateBrandAssetPatch,
  UpdateLocationPatch,
  UpdateProjectPatch,
  type BrandAssetId,
  type LocationId,
  type MediaAssetId,
  type Project,
  type ProjectId,
  type WorkspaceId,
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

export type LibraryApi = {
  listBrandAssets: (workspaceId: WorkspaceId) => Promise<BrandAsset[]>
  createBrandAsset: (input: CreateBrandAssetInput) => Promise<BrandAsset>
  updateBrandAsset: (id: BrandAssetId, patch: UpdateBrandAssetPatch) => Promise<BrandAsset>
  deleteBrandAsset: (id: BrandAssetId) => Promise<void>
  createLocation: (input: CreateLocationInput) => Promise<Location>
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
  listBrandAssets: async (workspaceId) => {
    const query = new URLSearchParams({ workspaceId })
    return requester.get(`/brand-assets?${query.toString()}`, WireBrandAssetList)
  },

  createBrandAsset: async (input) =>
    requester.post('/brand-assets', CreateBrandAssetInput.parse(input), WireBrandAsset),

  updateBrandAsset: async (id, patch) =>
    requester.patch(brandAssetPath(id), UpdateBrandAssetPatch.parse(patch), WireBrandAsset),

  deleteBrandAsset: async (id) => requester.remove(brandAssetPath(id)),

  createLocation: async (input) =>
    requester.post('/locations', CreateLocationInput.parse(input), WireLocationItem),

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

// ---------------------------------------------------------------------------
// BrandAsset のフォーム値 ↔ 送信本文
// ---------------------------------------------------------------------------

/**
 * 入力欄の生の値。`value` と `mediaAssetId` は種類によって使う側が変わるが、
 * **どちらを必須にするかはここで決めない**（判定はサーバ）。
 */
export type BrandAssetValues = {
  readonly category: string
  readonly name: string
  readonly value: string
  readonly mediaAssetId: MediaAssetId | null
  readonly usageRule: string
}

export const EMPTY_BRAND_ASSET_VALUES: BrandAssetValues = Object.freeze({
  category: BrandCategory.enum.color,
  name: '',
  value: '',
  mediaAssetId: null,
  usageRule: '',
})

export const brandAssetValuesOf = (asset: BrandAsset): BrandAssetValues => ({
  category: asset.category,
  name: asset.name,
  value: asset.value ?? '',
  mediaAssetId: asset.mediaAssetId,
  usageRule: asset.usageRule,
})

/** `workspaceId` を除いた BrandAsset の中身。作成にも更新にもそのまま渡せる形。 */
export type BrandAssetFields = {
  readonly category: BrandCategory
  readonly name: string
  readonly value: string | null
  readonly mediaAssetId: MediaAssetId | null
  readonly usageRule: string
}

/**
 * 入力欄の値を送信本文へ写す。
 * 空欄は「指定なし」の null にする。空文字を送ると、色として読めない値が残る。
 * 種類が候補外なら zod がここで落とす（select にしか無いので通常は起きない）。
 */
export const toBrandAssetInput = (values: BrandAssetValues): BrandAssetFields => ({
  category: BrandCategory.parse(values.category),
  name: values.name.trim(),
  value: values.value.trim() === '' ? null : values.value.trim(),
  mediaAssetId: values.mediaAssetId,
  usageRule: values.usageRule,
})

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
