import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { BrandAssetRepository, LocationRepository, MediaAssetRepository } from '@ixa/db'
import {
  BrandAsset as BrandAssetSchema,
  BrandAssetId as BrandAssetIdSchema,
  CreateBrandAssetInput as CreateBrandAssetInputSchema,
  CreateLocationInput as CreateLocationInputSchema,
  Location as LocationSchema,
  LocationId as LocationIdSchema,
  MediaAssetId as MediaAssetIdSchema,
  UpdateBrandAssetPatch as UpdateBrandAssetPatchSchema,
  UpdateLocationPatch as UpdateLocationPatchSchema,
  WorkspaceId as WorkspaceIdSchema,
  type BrandAsset,
  type MediaAssetId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import {
  errorContent, fail, listResponse, ok, okList, successResponse, type FieldErrors,
} from '../response.js'

/**
 * Asset Library（DOMAIN.md §6）の CRUD。Brand と Location をまとめて扱う。
 * MotionTemplate は別タスクのため含まない。
 */

export const BrandAssetResponse = BrandAssetSchema.openapi('BrandAsset')
export const LocationResponse = LocationSchema.openapi('Location')

/** color/font は MediaAsset を持たないことがあるので既定を与える。 */
const CreateBrandAssetBody = CreateBrandAssetInputSchema.extend({
  mediaAssetId: MediaAssetIdSchema.nullable().default(null),
  value: z.string().nullable().default(null),
}).openapi('CreateBrandAssetInput')
const UpdateBrandAssetBody = UpdateBrandAssetPatchSchema.openapi('UpdateBrandAssetPatch')
const CreateLocationBody = CreateLocationInputSchema.openapi('CreateLocationInput')
const UpdateLocationBody = UpdateLocationPatchSchema.openapi('UpdateLocationPatch')

const BrandAssetParams = z.object({
  id: BrandAssetIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})
const LocationParams = z.object({
  id: LocationIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})
const ListQuery = z.object({
  workspaceId: WorkspaceIdSchema.openapi({ param: { name: 'workspaceId', in: 'query' } }),
})

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const body = <T extends z.ZodTypeAny>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const MISSING_ASSET_MESSAGE = '参照する MediaAsset が存在しません'

/**
 * BrandAsset の組み合わせ規則。
 * category=color は value（#RRGGBB）が必須、それ以外は mediaAssetId が必須。
 * どちらも無い BrandAsset は Brand Review が参照できず、登録する意味がない。
 */
export const brandAssetFieldErrors = (
  asset: Pick<BrandAsset, 'category' | 'mediaAssetId' | 'value'>,
): FieldErrors | null => {
  if (asset.category === 'color') {
    if (asset.value === null) return { value: ['category=color では value が必須です'] }
    if (!HEX_COLOR.test(asset.value)) return { value: ['value は #RRGGBB 形式で指定してください'] }
    return null
  }
  if (asset.mediaAssetId === null) {
    return { mediaAssetId: ['category=color 以外では mediaAssetId が必須です'] }
  }
  return null
}

const listBrandAssetsRoute = createRoute({
  method: 'get', path: '/brand-assets', tags: ['assets'],
  summary: 'ワークスペース内の BrandAsset 一覧',
  request: { query: ListQuery },
  responses: { 200: jsonContent('BrandAsset 一覧', listResponse(BrandAssetResponse)), ...commonErrors },
})

const createBrandAssetRoute = createRoute({
  method: 'post', path: '/brand-assets', tags: ['assets'],
  summary: 'BrandAsset を作成する',
  request: { body: body(CreateBrandAssetBody) },
  responses: { 201: jsonContent('作成された BrandAsset', successResponse(BrandAssetResponse)), ...commonErrors },
})

const updateBrandAssetRoute = createRoute({
  method: 'patch', path: '/brand-assets/{id}', tags: ['assets'],
  summary: 'BrandAsset を部分更新する',
  request: { params: BrandAssetParams, body: body(UpdateBrandAssetBody) },
  responses: { 200: jsonContent('更新後の BrandAsset', successResponse(BrandAssetResponse)), ...commonErrors },
})

const deleteBrandAssetRoute = createRoute({
  method: 'delete', path: '/brand-assets/{id}', tags: ['assets'],
  summary: 'BrandAsset をソフトデリートする',
  request: { params: BrandAssetParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

const listLocationsRoute = createRoute({
  method: 'get', path: '/locations', tags: ['assets'],
  summary: 'ワークスペース内の Location 一覧',
  request: { query: ListQuery },
  responses: { 200: jsonContent('Location 一覧', listResponse(LocationResponse)), ...commonErrors },
})

const createLocationRoute = createRoute({
  method: 'post', path: '/locations', tags: ['assets'],
  summary: 'Location を作成する',
  request: { body: body(CreateLocationBody) },
  responses: { 201: jsonContent('作成された Location', successResponse(LocationResponse)), ...commonErrors },
})

const updateLocationRoute = createRoute({
  method: 'patch', path: '/locations/{id}', tags: ['assets'],
  summary: 'Location を部分更新する',
  request: { params: LocationParams, body: body(UpdateLocationBody) },
  responses: { 200: jsonContent('更新後の Location', successResponse(LocationResponse)), ...commonErrors },
})

const deleteLocationRoute = createRoute({
  method: 'delete', path: '/locations/{id}', tags: ['assets'],
  summary: 'Location をソフトデリートする',
  request: { params: LocationParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

export type AssetRoutesDeps = {
  brandAssets: BrandAssetRepository
  locations: LocationRepository
  /** 参照する MediaAsset の実在確認だけに使う。 */
  mediaAssets: MediaAssetRepository
}

export const assetRoutes = (deps: AssetRoutesDeps) => {
  /** 実在しない MediaAsset を弾く。null は「指定なし」として通す。 */
  const missingAssetIds = async (
    ids: readonly (MediaAssetId | null | undefined)[],
  ): Promise<readonly MediaAssetId[]> => {
    const targets = ids.filter((id): id is MediaAssetId => id !== null && id !== undefined)
    const found = await Promise.all(targets.map((id) => deps.mediaAssets.findById(id)))
    return targets.filter((_, index) => found[index] === null)
  }

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listBrandAssetsRoute, async (c) => {
      const found = await deps.brandAssets.findByWorkspace(c.req.valid('query').workspaceId)
      return c.json(okList(found), 200)
    })
    .openapi(createBrandAssetRoute, async (c) => {
      const input = c.req.valid('json')
      const fields = brandAssetFieldErrors(input)
      if (fields !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, fields), 422)
      if ((await missingAssetIds([input.mediaAssetId])).length > 0) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { mediaAssetId: [MISSING_ASSET_MESSAGE] }), 422)
      }
      return c.json(ok(await deps.brandAssets.create(input)), 201)
    })
    .openapi(updateBrandAssetRoute, async (c) => {
      const { id } = c.req.valid('param')
      const current = await deps.brandAssets.findById(id)
      if (current === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const patch = c.req.valid('json')
      // 組み合わせ規則は更新後の姿で判定する。patch だけでは color かどうか決まらない。
      const fields = brandAssetFieldErrors({ ...current, ...patch })
      if (fields !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, fields), 422)
      if ((await missingAssetIds([patch.mediaAssetId])).length > 0) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { mediaAssetId: [MISSING_ASSET_MESSAGE] }), 422)
      }
      return c.json(ok(await deps.brandAssets.update(id, patch)), 200)
    })
    .openapi(deleteBrandAssetRoute, async (c) => {
      await deps.brandAssets.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
    .openapi(listLocationsRoute, async (c) => {
      const found = await deps.locations.findByWorkspace(c.req.valid('query').workspaceId)
      return c.json(okList(found), 200)
    })
    .openapi(createLocationRoute, async (c) => {
      const input = c.req.valid('json')
      const missing = await missingAssetIds(input.referenceAssetIds ?? [])
      if (missing.length > 0) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { referenceAssetIds: [MISSING_ASSET_MESSAGE] }),
          422,
        )
      }
      return c.json(ok(await deps.locations.create(input)), 201)
    })
    .openapi(updateLocationRoute, async (c) => {
      const patch = c.req.valid('json')
      const missing = await missingAssetIds(patch.referenceAssetIds ?? [])
      if (missing.length > 0) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { referenceAssetIds: [MISSING_ASSET_MESSAGE] }),
          422,
        )
      }
      const updated = await deps.locations.update(c.req.valid('param').id, patch)
      return c.json(ok(updated), 200)
    })
    .openapi(deleteLocationRoute, async (c) => {
      await deps.locations.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
}
