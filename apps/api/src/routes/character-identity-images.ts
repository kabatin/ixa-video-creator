import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { CharacterRepository, MediaAssetRepository } from '@ixa/db'
import {
  CharacterId as CharacterIdSchema,
  CharacterIdentityImage as CharacterIdentityImageSchema,
  CharacterIdentityImageId as CharacterIdentityImageIdSchema,
  CreateCharacterIdentityImageInput as CreateCharacterIdentityImageInputSchema,
  type MediaAssetId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * Character の識別画像（DOMAIN.md §5）。`characterRoutes` から mount される。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 *
 * スキーマと小さなヘルパは characters.ts から import せず、ここで定義している。
 * characters.ts がこのファイルを import する以上、逆向きの import は循環になるため。
 */

export const IdentityImageResponse = CharacterIdentityImageSchema.openapi('CharacterIdentityImage')

const CreateIdentityImageBody = CreateCharacterIdentityImageInputSchema.omit({
  characterId: true,
}).openapi('CreateCharacterIdentityImageInput')

const pathId = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ id: schema.openapi({ param: { name: 'id', in: 'path' } }) })

const CharacterParams = pathId(CharacterIdSchema)
const IdentityImageParams = pathId(CharacterIdentityImageIdSchema)

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}

const body = <T extends z.ZodTypeAny>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
})

const listIdentityImagesRoute = createRoute({
  method: 'get', path: '/characters/{id}/identity-images', tags: ['characters'],
  summary: '識別画像の一覧（order 昇順）',
  request: { params: CharacterParams },
  responses: { 200: jsonContent('識別画像一覧', listResponse(IdentityImageResponse)), ...commonErrors },
})

const addIdentityImageRoute = createRoute({
  method: 'post', path: '/characters/{id}/identity-images', tags: ['characters'],
  summary: '識別画像を追加する',
  request: { params: CharacterParams, body: body(CreateIdentityImageBody) },
  responses: { 201: jsonContent('追加された識別画像', successResponse(IdentityImageResponse)), ...commonErrors },
})

const removeIdentityImageRoute = createRoute({
  method: 'delete', path: '/identity-images/{id}', tags: ['characters'],
  summary: '識別画像を削除する',
  request: { params: IdentityImageParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

const setPrimaryIdentityImageRoute = createRoute({
  method: 'post', path: '/identity-images/{id}/primary', tags: ['characters'],
  summary: '同じ role の主画像にする（他は解除される）',
  request: { params: IdentityImageParams },
  responses: { 200: jsonContent('主画像になった識別画像', successResponse(IdentityImageResponse)), ...commonErrors },
})

/** `CharacterRoutesDeps` の部分集合。識別画像は Look を知らなくてよい。 */
export type IdentityImageRoutesDeps = {
  characters: CharacterRepository
  /** 参照する MediaAsset の実在確認だけに使う。 */
  mediaAssets: MediaAssetRepository
}

const MISSING_ASSET_MESSAGE = '参照する MediaAsset が存在しません'

export const identityImageRoutes = (deps: IdentityImageRoutesDeps) => {
  /** 参照先が実在しない MediaAsset を弾く。null は「指定なし」として通す。 */
  const assetMissing = async (id: MediaAssetId | null | undefined): Promise<boolean> =>
    id !== null && id !== undefined && (await deps.mediaAssets.findById(id)) === null

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listIdentityImagesRoute, async (c) => {
      const { id } = c.req.valid('param')
      if ((await deps.characters.findById(id)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(okList(await deps.characters.listIdentityImages(id)), 200)
    })
    .openapi(addIdentityImageRoute, async (c) => {
      const { id } = c.req.valid('param')
      if ((await deps.characters.findById(id)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const input = c.req.valid('json')
      if (await assetMissing(input.mediaAssetId)) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { mediaAssetId: [MISSING_ASSET_MESSAGE] }), 422)
      }
      const created = await deps.characters.addIdentityImage({ ...input, characterId: id })
      return c.json(ok(created), 201)
    })
    .openapi(removeIdentityImageRoute, async (c) => {
      await deps.characters.removeIdentityImage(c.req.valid('param').id)
      return c.body(null, 204)
    })
    .openapi(setPrimaryIdentityImageRoute, async (c) => {
      const { id } = c.req.valid('param')
      // role と characterId は画像自身が持つ。経路には画像 ID しか無いので引き直す。
      const image = await deps.characters.findIdentityImageById(id)
      if (image === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const updated = await deps.characters.setPrimaryIdentityImage(
        image.characterId, image.id, image.role,
      )
      return c.json(ok(updated), 200)
    })
}
