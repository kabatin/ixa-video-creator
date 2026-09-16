import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { CharacterLookRepository, CharacterRepository, MediaAssetRepository } from '@ixa/db'
import { CharacterLookInvariantError } from '@ixa/db'
import {
  CharacterId as CharacterIdSchema,
  CharacterLook as CharacterLookSchema,
  CharacterLookId as CharacterLookIdSchema,
  CharacterLookImage as CharacterLookImageSchema,
  CharacterLookImageId as CharacterLookImageIdSchema,
  CreateCharacterLookImageInput as CreateCharacterLookImageInputSchema,
  CreateCharacterLookInput as CreateCharacterLookInputSchema,
  MediaAssetId as MediaAssetIdSchema,
  UpdateCharacterLookPatch as UpdateCharacterLookPatchSchema,
  type MediaAssetId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, listResponse, ok, okList, successResponse } from '../response.js'

/**
 * Look とその参照画像（DOMAIN.md §5）。`characterRoutes` から mount される。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 * 不変条件（既定 Look が必ず 1 つ）の実装は packages/db 側が持ち、ここは HTTP へ写すだけ。
 *
 * スキーマと小さなヘルパは characters.ts から import せず、ここで定義している。
 * characters.ts がこのファイルを import する以上、逆向きの import は循環になるため。
 */

export const LookResponse = CharacterLookSchema.openapi('CharacterLook')
export const LookImageResponse = CharacterLookImageSchema.openapi('CharacterLookImage')

/** era と canonicalFrameAssetId は登録時点では決まっていないことが多いので既定を与える。 */
const CreateLookBody = CreateCharacterLookInputSchema.omit({ characterId: true })
  .extend({
    era: z.string().nullable().default(null),
    canonicalFrameAssetId: MediaAssetIdSchema.nullable().default(null),
  })
  .openapi('CreateCharacterLookInput')
const UpdateLookBody = UpdateCharacterLookPatchSchema.openapi('UpdateCharacterLookPatch')
const CreateLookImageBody = CreateCharacterLookImageInputSchema.omit({ lookId: true }).openapi(
  'CreateCharacterLookImageInput',
)
const CanonicalFrameBody = z
  .object({ mediaAssetId: MediaAssetIdSchema })
  .openapi('SetCanonicalFrameInput')

const pathId = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ id: schema.openapi({ param: { name: 'id', in: 'path' } }) })

const CharacterParams = pathId(CharacterIdSchema)
const LookParams = pathId(CharacterLookIdSchema)
const LookImageParams = pathId(CharacterLookImageIdSchema)

const jsonContent = <T extends z.ZodTypeAny>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
})

const commonErrors = {
  404: errorContent('対象が存在しない'),
  422: errorContent('入力の検証に失敗した'),
  500: errorContent('サーバ内部エラー'),
}
const withConflict = { ...commonErrors, 409: errorContent('同じ key の Look が既にある') }

const body = <T extends z.ZodTypeAny>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
})

const listLooksRoute = createRoute({
  method: 'get', path: '/characters/{id}/looks', tags: ['characters'],
  summary: 'Look の一覧（key 昇順）',
  request: { params: CharacterParams },
  responses: { 200: jsonContent('Look 一覧', listResponse(LookResponse)), ...commonErrors },
})

const createLookRoute = createRoute({
  method: 'post', path: '/characters/{id}/looks', tags: ['characters'],
  summary: 'Look を作成する（最初の Look は必ず既定になる）',
  request: { params: CharacterParams, body: body(CreateLookBody) },
  responses: { 201: jsonContent('作成された Look', successResponse(LookResponse)), ...withConflict },
})

const getLookRoute = createRoute({
  method: 'get', path: '/looks/{id}', tags: ['characters'],
  summary: 'Look を 1 件取得する',
  request: { params: LookParams },
  responses: { 200: jsonContent('Look', successResponse(LookResponse)), ...commonErrors },
})

const updateLookRoute = createRoute({
  method: 'patch', path: '/looks/{id}', tags: ['characters'],
  summary: 'Look を部分更新する（key は変更できない）',
  request: { params: LookParams, body: body(UpdateLookBody) },
  responses: { 200: jsonContent('更新後の Look', successResponse(LookResponse)), ...commonErrors },
})

const deleteLookRoute = createRoute({
  method: 'delete', path: '/looks/{id}', tags: ['characters'],
  summary: 'Look をソフトデリートする（最後の 1 つは削除できない）',
  request: { params: LookParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

const listLookImagesRoute = createRoute({
  method: 'get', path: '/looks/{id}/images', tags: ['characters'],
  summary: 'Look 画像の一覧（order 昇順）',
  request: { params: LookParams },
  responses: { 200: jsonContent('Look 画像一覧', listResponse(LookImageResponse)), ...commonErrors },
})

const addLookImageRoute = createRoute({
  method: 'post', path: '/looks/{id}/images', tags: ['characters'],
  summary: 'Look 画像を追加する',
  request: { params: LookParams, body: body(CreateLookImageBody) },
  responses: { 201: jsonContent('追加された Look 画像', successResponse(LookImageResponse)), ...commonErrors },
})

const removeLookImageRoute = createRoute({
  method: 'delete', path: '/look-images/{id}', tags: ['characters'],
  summary: 'Look 画像を削除する',
  request: { params: LookImageParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
})

const setCanonicalFrameRoute = createRoute({
  method: 'post', path: '/looks/{id}/canonical-frame', tags: ['characters'],
  summary: '承認 Take のフレームを canonical reference に昇格させる',
  request: { params: LookParams, body: body(CanonicalFrameBody) },
  responses: { 200: jsonContent('更新後の Look', successResponse(LookResponse)), ...commonErrors },
})

/** `CharacterRoutesDeps` の部分集合。Character は親の実在確認にだけ使う。 */
export type LookRoutesDeps = {
  characters: CharacterRepository
  looks: CharacterLookRepository
  /** 参照する MediaAsset の実在確認だけに使う。 */
  mediaAssets: MediaAssetRepository
}

const MISSING_ASSET_MESSAGE = '参照する MediaAsset が存在しません'
const DUPLICATE_KEY_MESSAGE = '同じ key の Look が既に存在します'

export const lookRoutes = (deps: LookRoutesDeps) => {
  /** 参照先が実在しない MediaAsset を弾く。null は「指定なし」として通す。 */
  const assetMissing = async (id: MediaAssetId | null | undefined): Promise<boolean> =>
    id !== null && id !== undefined && (await deps.mediaAssets.findById(id)) === null

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listLooksRoute, async (c) => {
      const { id } = c.req.valid('param')
      if ((await deps.characters.findById(id)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(okList(await deps.looks.findByCharacter(id)), 200)
    })
    .openapi(createLookRoute, async (c) => {
      const { id } = c.req.valid('param')
      if ((await deps.characters.findById(id)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const input = c.req.valid('json')
      if ((await deps.looks.findByKey(id, input.key)) !== null) {
        return c.json(fail(DUPLICATE_KEY_MESSAGE, { key: [DUPLICATE_KEY_MESSAGE] }), 409)
      }
      if (await assetMissing(input.canonicalFrameAssetId)) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { canonicalFrameAssetId: [MISSING_ASSET_MESSAGE] }),
          422,
        )
      }
      const created = await deps.looks.create({ ...input, characterId: id })
      return c.json(ok(created), 201)
    })
    .openapi(getLookRoute, async (c) => {
      const look = await deps.looks.findById(c.req.valid('param').id)
      if (look === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(look), 200)
    })
    .openapi(updateLookRoute, async (c) => {
      const patch = c.req.valid('json')
      if (await assetMissing(patch.canonicalFrameAssetId)) {
        return c.json(
          fail(VALIDATION_ERROR_MESSAGE, { canonicalFrameAssetId: [MISSING_ASSET_MESSAGE] }),
          422,
        )
      }
      try {
        const updated = await deps.looks.update(c.req.valid('param').id, patch)
        return c.json(ok(updated), 200)
      } catch (error) {
        if (error instanceof CharacterLookInvariantError) {
          return c.json(fail(error.message, { isDefault: [error.message] }), 422)
        }
        throw error
      }
    })
    .openapi(deleteLookRoute, async (c) => {
      try {
        await deps.looks.softDelete(c.req.valid('param').id)
      } catch (error) {
        if (error instanceof CharacterLookInvariantError) {
          return c.json(fail(error.message, { look: [error.message] }), 422)
        }
        throw error
      }
      return c.body(null, 204)
    })
    .openapi(listLookImagesRoute, async (c) => {
      const { id } = c.req.valid('param')
      if ((await deps.looks.findById(id)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(okList(await deps.looks.listLookImages(id)), 200)
    })
    .openapi(addLookImageRoute, async (c) => {
      const { id } = c.req.valid('param')
      if ((await deps.looks.findById(id)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const input = c.req.valid('json')
      if (await assetMissing(input.mediaAssetId)) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { mediaAssetId: [MISSING_ASSET_MESSAGE] }), 422)
      }
      const created = await deps.looks.addLookImage({ ...input, lookId: id })
      return c.json(ok(created), 201)
    })
    .openapi(removeLookImageRoute, async (c) => {
      await deps.looks.removeLookImage(c.req.valid('param').id)
      return c.body(null, 204)
    })
    .openapi(setCanonicalFrameRoute, async (c) => {
      const { id } = c.req.valid('param')
      if ((await deps.looks.findById(id)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const { mediaAssetId } = c.req.valid('json')
      if (await assetMissing(mediaAssetId)) {
        return c.json(fail(VALIDATION_ERROR_MESSAGE, { mediaAssetId: [MISSING_ASSET_MESSAGE] }), 422)
      }
      return c.json(ok(await deps.looks.setCanonicalFrame(id, mediaAssetId)), 200)
    })
}
