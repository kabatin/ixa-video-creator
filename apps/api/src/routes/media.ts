import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { MediaAssetRepository } from '@ixa/db'
import {
  MediaAsset as MediaAssetSchema,
  MediaAssetId as MediaAssetIdSchema,
  ProjectId as ProjectIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  type MediaAsset,
} from '@ixa/domain'
import type { ObjectStorage } from '@ixa/storage'
import { NOT_FOUND_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * MediaAsset の参照・署名付き GET URL 発行・ソフトデリート。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 */

/** `GET /media/{id}/url` の既定有効期限（秒）。 */
export const DEFAULT_SIGNED_URL_EXPIRES_SEC = 300

/** `GET /media/{id}/url` で指定できる有効期限の上限（秒）。 */
export const MAX_SIGNED_URL_EXPIRES_SEC = 3600

/**
 * 派生物がまだ無いときの理由。
 *
 * **MediaAsset は在る**ので 404 ではない。取り込みキューが後から埋める列
 * （`thumbnailKey` / `posterKeys`）が空なだけで、待てば埋まる。
 * 一覧側（`shot-posters.ts`）も同じ状態を説明するため、文言はここだけに置く（L-016）。
 */
export const DERIVED_NOT_READY_MESSAGE = 'サムネイルがまだ作られていません（media の処理待ち）'

/** ポスターフレームがまだ切り出されていないときの理由。 */
export const POSTERS_NOT_READY_MESSAGE =
  'ポスターフレームがまだ作られていません（media の処理待ち）'

/** `index` が `posterKeys` の範囲を超えたときの理由。 */
export const POSTER_INDEX_OUT_OF_RANGE_MESSAGE = 'ポスターフレームの index が範囲外です'

/**
 * API が返す MediaAsset。Domain の `MediaAsset` と同じ形だが、
 * 日時は JSON で表現できる ISO8601 文字列にする。
 * 署名付き URL は含めない（CLAUDE.md 規約 7）。必要なら `GET /media/{id}/url` で都度発行する。
 */
export const MediaAssetResponse = MediaAssetSchema.omit({ createdAt: true })
  .extend({ createdAt: z.string().datetime() })
  .openapi('MediaAsset')
export type MediaAssetResponse = z.infer<typeof MediaAssetResponse>

/** Domain の MediaAsset を API の DTO へ写す（新しいオブジェクトを返す）。 */
export const toMediaAssetResponse = (asset: MediaAsset): MediaAssetResponse => ({
  ...asset,
  createdAt: asset.createdAt.toISOString(),
})

const SignedUrlData = z
  .object({
    url: z.string().min(1).openapi({ description: '都度発行する署名付き GET URL' }),
    expiresInSec: z.number().int().positive(),
  })
  .openapi('SignedUrlResult')

const MediaParams = z.object({
  id: MediaAssetIdSchema.openapi({ param: { name: 'id', in: 'path' } }),
})

/**
 * どのキーに署名するか。省略時は本体（`storageKey`）。
 * 派生物は取り込みキューが後から埋めるため、無いことが正常にあり得る。
 */
export const MediaVariant = z.enum(['thumbnail', 'poster'])
export type MediaVariant = z.infer<typeof MediaVariant>

const SignedUrlQuery = z.object({
  expiresInSec: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_SIGNED_URL_EXPIRES_SEC)
    .default(DEFAULT_SIGNED_URL_EXPIRES_SEC)
    .openapi({ param: { name: 'expiresInSec', in: 'query', required: false }, example: 300 }),
  variant: MediaVariant.optional().openapi({
    param: { name: 'variant', in: 'query', required: false },
    description: '省略すると本体。thumbnail / poster は派生物のキーに署名する',
  }),
  index: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(0)
    .openapi({ param: { name: 'index', in: 'query', required: false }, example: 0 }),
})

/**
 * 署名するキーの決定結果。
 * 「まだ無い」（409）と「指定が範囲外」（422）を潰さずに分けて運ぶ。
 */
type KeyResolution =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly status: 409 | 422; readonly message: string }

/** variant / index から署名対象のキーを選ぶ。純粋関数。 */
export const resolveVariantKey = (
  asset: MediaAsset,
  variant: MediaVariant | undefined,
  index: number,
): KeyResolution => {
  if (variant === undefined) return { ok: true, key: asset.storageKey }
  if (variant === 'thumbnail') {
    return asset.thumbnailKey === null
      ? { ok: false, status: 409, message: DERIVED_NOT_READY_MESSAGE }
      : { ok: true, key: asset.thumbnailKey }
  }
  if (asset.posterKeys.length === 0) {
    return { ok: false, status: 409, message: POSTERS_NOT_READY_MESSAGE }
  }
  const key = asset.posterKeys[index]
  return key === undefined
    ? { ok: false, status: 422, message: POSTER_INDEX_OUT_OF_RANGE_MESSAGE }
    : { ok: true, key }
}

const ListMediaQuery = z.object({
  workspaceId: WorkspaceIdSchema.openapi({ param: { name: 'workspaceId', in: 'query' } }),
  projectId: ProjectIdSchema.optional().openapi({
    param: { name: 'projectId', in: 'query', required: false },
  }),
})

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const getMediaRoute = createRoute({
  method: 'get',
  path: '/media/{id}',
  tags: ['media'],
  summary: 'MediaAsset を 1 件取得する',
  request: { params: MediaParams },
  responses: {
    200: jsonContent('MediaAsset', successResponse(MediaAssetResponse)),
    404: errorContent('MediaAsset が存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const getMediaUrlRoute = createRoute({
  method: 'get',
  path: '/media/{id}/url',
  tags: ['media'],
  summary: '署名付き GET URL を発行する（保存せず都度発行する）',
  request: { params: MediaParams, query: SignedUrlQuery },
  responses: {
    200: jsonContent('署名付き GET URL', successResponse(SignedUrlData)),
    404: errorContent('MediaAsset が存在しない'),
    409: errorContent('MediaAsset は在るが、指定した派生物がまだ作られていない'),
    422: errorContent('入力の検証に失敗した / index が範囲外'),
    500: errorContent('サーバ内部エラー'),
  },
})

const listMediaRoute = createRoute({
  method: 'get',
  path: '/media',
  tags: ['media'],
  summary: 'ワークスペース内の MediaAsset 一覧（projectId で絞り込める）',
  request: { query: ListMediaQuery },
  responses: {
    200: jsonContent('MediaAsset 一覧', listResponse(MediaAssetResponse)),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

const deleteMediaRoute = createRoute({
  method: 'delete',
  path: '/media/{id}',
  tags: ['media'],
  summary: 'MediaAsset をソフトデリートする（ストレージのオブジェクトは消さない）',
  request: { params: MediaParams },
  responses: {
    204: { description: '削除した（本文なし）' },
    404: errorContent('MediaAsset が存在しない'),
    422: errorContent('入力の検証に失敗した'),
    500: errorContent('サーバ内部エラー'),
  },
})

export type MediaRoutesDeps = {
  mediaAssets: MediaAssetRepository
  storage: ObjectStorage
}

export const mediaRoutes = ({ mediaAssets, storage }: MediaRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listMediaRoute, async (c) => {
      const { workspaceId, projectId } = c.req.valid('query')
      // projectId 指定時も workspaceId で絞る。別ワークスペースの行を返さないため。
      const found =
        projectId === undefined
          ? await mediaAssets.findByWorkspace(workspaceId)
          : (await mediaAssets.findByProject(projectId)).filter(
              (asset) => asset.workspaceId === workspaceId,
            )
      return c.json(okList(found.map(toMediaAssetResponse)), 200)
    })
    .openapi(getMediaRoute, async (c) => {
      const found = await mediaAssets.findById(c.req.valid('param').id)
      if (found === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }
      return c.json(ok(toMediaAssetResponse(found)), 200)
    })
    .openapi(getMediaUrlRoute, async (c) => {
      const found = await mediaAssets.findById(c.req.valid('param').id)
      if (found === null) {
        return c.json(fail(NOT_FOUND_MESSAGE), 404)
      }
      const { expiresInSec, variant, index } = c.req.valid('query')
      const resolved = resolveVariantKey(found, variant, index)
      if (!resolved.ok) {
        return c.json(fail(resolved.message), resolved.status)
      }
      // 期限切れ URL の事故を避けるため DB には保存せず、要求のたびに発行する（CLAUDE.md 規約 7）。
      const url = await storage.signedGetUrl(resolved.key, expiresInSec)
      return c.json(ok({ url, expiresInSec }), 200)
    })
    .openapi(deleteMediaRoute, async (c) => {
      // TODO: ストレージのオブジェクトは削除しない。他の MediaAsset や
      // レンダリング結果から同じ key が参照されている可能性があるため、
      // 実体の回収は参照カウントを持つ GC ジョブ側で行う。
      await mediaAssets.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
