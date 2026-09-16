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

const SignedUrlQuery = z.object({
  expiresInSec: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_SIGNED_URL_EXPIRES_SEC)
    .default(DEFAULT_SIGNED_URL_EXPIRES_SEC)
    .openapi({ param: { name: 'expiresInSec', in: 'query', required: false }, example: 300 }),
})

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
    422: errorContent('入力の検証に失敗した'),
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
      const { expiresInSec } = c.req.valid('query')
      // 期限切れ URL の事故を避けるため DB には保存せず、要求のたびに発行する（CLAUDE.md 規約 7）。
      const url = await storage.signedGetUrl(found.storageKey, expiresInSec)
      return c.json(ok({ url, expiresInSec }), 200)
    })
    .openapi(deleteMediaRoute, async (c) => {
      // TODO: ストレージのオブジェクトは削除しない。他の MediaAsset や
      // レンダリング結果から同じ key が参照されている可能性があるため、
      // 実体の回収は参照カウントを持つ GC ジョブ側で行う。
      await mediaAssets.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
