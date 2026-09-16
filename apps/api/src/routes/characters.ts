import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  CharacterLookRepository, CharacterRepository, MediaAssetRepository,
  ShotCharacterRepository, ShotRepository,
} from '@ixa/db'
import { CharacterLookInvariantError } from '@ixa/db'
import {
  Character as CharacterSchema,
  CharacterId as CharacterIdSchema,
  CharacterIdentityImage as CharacterIdentityImageSchema,
  CharacterIdentityImageId as CharacterIdentityImageIdSchema,
  CharacterLook as CharacterLookSchema,
  CharacterLookId as CharacterLookIdSchema,
  CharacterLookImage as CharacterLookImageSchema,
  CharacterLookImageId as CharacterLookImageIdSchema,
  CreateCharacterIdentityImageInput as CreateCharacterIdentityImageInputSchema,
  CreateCharacterInput as CreateCharacterInputSchema,
  CreateCharacterLookImageInput as CreateCharacterLookImageInputSchema,
  CreateCharacterLookInput as CreateCharacterLookInputSchema,
  MediaAssetId as MediaAssetIdSchema,
  ShotCharacter as ShotCharacterSchema,
  ShotId as ShotIdSchema,
  UpdateCharacterLookPatch as UpdateCharacterLookPatchSchema,
  UpdateCharacterPatch as UpdateCharacterPatchSchema,
  WorkspaceId as WorkspaceIdSchema,
  type Character,
  type MediaAssetId,
  type ShotId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import {
  errorContent, fail, listResponse, ok, okList, successResponse, type FieldErrors,
} from '../response.js'

/**
 * Character / Look とその参照画像の CRUD（DOMAIN.md §5 / ARCHITECTURE.md §8）。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 * 不変条件（既定 Look が必ず 1 つ）の実装は packages/db 側が持ち、ここは HTTP へ写すだけ。
 */

export const CharacterResponse = CharacterSchema.omit({ createdAt: true })
  .extend({ createdAt: z.string().datetime() })
  .openapi('Character')
export type CharacterResponse = z.infer<typeof CharacterResponse>

export const toCharacterResponse = (character: Character): CharacterResponse => ({
  ...character,
  createdAt: character.createdAt.toISOString(),
})

export const IdentityImageResponse = CharacterIdentityImageSchema.openapi('CharacterIdentityImage')
export const LookResponse = CharacterLookSchema.openapi('CharacterLook')
export const LookImageResponse = CharacterLookImageSchema.openapi('CharacterLookImage')

const CreateCharacterBody = CreateCharacterInputSchema.openapi('CreateCharacterInput')
const UpdateCharacterBody = UpdateCharacterPatchSchema.openapi('UpdateCharacterPatch')
/** era と canonicalFrameAssetId は登録時点では決まっていないことが多いので既定を与える。 */
const CreateLookBody = CreateCharacterLookInputSchema.omit({ characterId: true })
  .extend({
    era: z.string().nullable().default(null),
    canonicalFrameAssetId: MediaAssetIdSchema.nullable().default(null),
  })
  .openapi('CreateCharacterLookInput')
const UpdateLookBody = UpdateCharacterLookPatchSchema.openapi('UpdateCharacterLookPatch')
const CreateIdentityImageBody = CreateCharacterIdentityImageInputSchema.omit({
  characterId: true,
}).openapi('CreateCharacterIdentityImageInput')
const CreateLookImageBody = CreateCharacterLookImageInputSchema.omit({ lookId: true }).openapi(
  'CreateCharacterLookImageInput',
)
const CanonicalFrameBody = z
  .object({ mediaAssetId: MediaAssetIdSchema })
  .openapi('SetCanonicalFrameInput')

const pathId = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ id: schema.openapi({ param: { name: 'id', in: 'path' } }) })

const CharacterParams = pathId(CharacterIdSchema)
const IdentityImageParams = pathId(CharacterIdentityImageIdSchema)
const LookParams = pathId(CharacterLookIdSchema)
const LookImageParams = pathId(CharacterLookImageIdSchema)
const ListQuery = z.object({
  workspaceId: WorkspaceIdSchema.openapi({ param: { name: 'workspaceId', in: 'query' } }),
})

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

const listCharactersRoute = createRoute({
  method: 'get', path: '/characters', tags: ['characters'],
  summary: 'ワークスペース内の Character 一覧',
  request: { query: ListQuery },
  responses: { 200: jsonContent('Character 一覧', listResponse(CharacterResponse)), ...commonErrors },
})

const createCharacterRoute = createRoute({
  method: 'post', path: '/characters', tags: ['characters'],
  summary: 'Character を作成する',
  request: { body: body(CreateCharacterBody) },
  responses: { 201: jsonContent('作成された Character', successResponse(CharacterResponse)), ...commonErrors },
})

const getCharacterRoute = createRoute({
  method: 'get', path: '/characters/{id}', tags: ['characters'],
  summary: 'Character を 1 件取得する',
  request: { params: CharacterParams },
  responses: { 200: jsonContent('Character', successResponse(CharacterResponse)), ...commonErrors },
})

const updateCharacterRoute = createRoute({
  method: 'patch', path: '/characters/{id}', tags: ['characters'],
  summary: 'Character を部分更新する',
  request: { params: CharacterParams, body: body(UpdateCharacterBody) },
  responses: { 200: jsonContent('更新後の Character', successResponse(CharacterResponse)), ...commonErrors },
})

const deleteCharacterRoute = createRoute({
  method: 'delete', path: '/characters/{id}', tags: ['characters'],
  summary: 'Character をソフトデリートする',
  request: { params: CharacterParams },
  responses: { 204: { description: '削除した（本文なし）' }, ...commonErrors },
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

export type CharacterRoutesDeps = {
  characters: CharacterRepository
  looks: CharacterLookRepository
  /** 参照する MediaAsset の実在確認だけに使う。 */
  mediaAssets: MediaAssetRepository
}

const MISSING_ASSET_MESSAGE = '参照する MediaAsset が存在しません'
const DUPLICATE_KEY_MESSAGE = '同じ key の Look が既に存在します'

export const characterRoutes = (deps: CharacterRoutesDeps) => {
  /** 参照先が実在しない MediaAsset を弾く。null は「指定なし」として通す。 */
  const assetMissing = async (id: MediaAssetId | null | undefined): Promise<boolean> =>
    id !== null && id !== undefined && (await deps.mediaAssets.findById(id)) === null

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listCharactersRoute, async (c) => {
      const found = await deps.characters.findByWorkspace(c.req.valid('query').workspaceId)
      return c.json(okList(found.map(toCharacterResponse)), 200)
    })
    .openapi(createCharacterRoute, async (c) => {
      const created = await deps.characters.create(c.req.valid('json'))
      return c.json(ok(toCharacterResponse(created)), 201)
    })
    .openapi(getCharacterRoute, async (c) => {
      const found = await deps.characters.findById(c.req.valid('param').id)
      if (found === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(ok(toCharacterResponse(found)), 200)
    })
    .openapi(updateCharacterRoute, async (c) => {
      const updated = await deps.characters.update(c.req.valid('param').id, c.req.valid('json'))
      return c.json(ok(toCharacterResponse(updated)), 200)
    })
    .openapi(deleteCharacterRoute, async (c) => {
      await deps.characters.softDelete(c.req.valid('param').id)
      return c.body(null, 204)
    })
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

// ---------------------------------------------------------------------------
// Shot への登場人物の紐づけ（DOMAIN.md §9 ShotCharacter）
// ---------------------------------------------------------------------------

/**
 * `characterRoutes` とは別の factory にしてある。
 * 既存の Character CRUD は Shot を知らなくてよく、依存を増やすと
 * Character だけを扱う呼び出し側に無関係なリポジトリを強いることになるため。
 */

export const ShotCharacterResponse = ShotCharacterSchema.openapi('ShotCharacter')

/** shotId は経路が持つので本文には含めない。正が 2 つになるのを避ける。 */
const ShotCharacterEntryBody = ShotCharacterSchema.omit({ shotId: true })
const ReplaceShotCharactersBody = z
  .object({ entries: z.array(ShotCharacterEntryBody) })
  .openapi('ReplaceShotCharactersInput')

const ShotCharacterParams = z.object({
  shotId: ShotIdSchema.openapi({ param: { name: 'shotId', in: 'path' } }),
})
const ShotCharacterKeyParams = ShotCharacterParams.extend({
  characterId: CharacterIdSchema.openapi({ param: { name: 'characterId', in: 'path' } }),
})

const listShotCharactersRoute = createRoute({
  method: 'get', path: '/shots/{shotId}/characters', tags: ['characters'],
  summary: 'Shot の登場人物一覧（order 昇順）',
  request: { params: ShotCharacterParams },
  responses: { 200: jsonContent('登場人物一覧', listResponse(ShotCharacterResponse)), ...commonErrors },
})

const replaceShotCharactersRoute = createRoute({
  method: 'put', path: '/shots/{shotId}/characters', tags: ['characters'],
  summary: 'Shot の登場人物を一括で置き換える',
  request: { params: ShotCharacterParams, body: body(ReplaceShotCharactersBody) },
  responses: {
    200: jsonContent('置き換え後の登場人物一覧', listResponse(ShotCharacterResponse)),
    ...commonErrors,
  },
})

const removeShotCharacterRoute = createRoute({
  method: 'delete', path: '/shots/{shotId}/characters/{characterId}', tags: ['characters'],
  summary: 'Shot から登場人物を外す',
  request: { params: ShotCharacterKeyParams },
  responses: { 204: { description: '外した（本文なし）' }, ...commonErrors },
})

export type ShotCharacterRoutesDeps = {
  shots: ShotRepository
  shotCharacters: ShotCharacterRepository
  characters: CharacterRepository
  looks: CharacterLookRepository
}

const DUPLICATE_CHARACTER_MESSAGE = '同じ Character が複数回指定されています'
const MISSING_CHARACTER_MESSAGE = '指定された Character が存在しません'
const MISSING_LOOK_MESSAGE = '指定された Look が存在しません'
const FOREIGN_LOOK_MESSAGE = '指定された Look はその Character のものではありません'

export const shotCharacterRoutes = (deps: ShotCharacterRoutesDeps) => {
  /**
   * 紐づけの妥当性を確かめ、問題があればフィールドエラーを返す（無ければ null）。
   *
   * 人数分の findById を直列に await すると往復が人数に比例する。
   * 1 回の Promise.all にまとめ、段数を一定に保つ。
   */
  const invalidEntries = async (
    entries: readonly z.infer<typeof ShotCharacterEntryBody>[],
  ): Promise<FieldErrors | null> => {
    const ids = entries.map((entry) => entry.characterId)
    if (new Set(ids).size !== ids.length) {
      return { characterId: [DUPLICATE_CHARACTER_MESSAGE] }
    }

    const resolved = await Promise.all(
      entries.map(async (entry) => {
        const [character, look] = await Promise.all([
          deps.characters.findById(entry.characterId),
          deps.looks.findById(entry.lookId),
        ])
        return { entry, character, look }
      }),
    )

    if (resolved.some((r) => r.character === null)) {
      return { characterId: [MISSING_CHARACTER_MESSAGE] }
    }
    if (resolved.some((r) => r.look === null)) {
      return { lookId: [MISSING_LOOK_MESSAGE] }
    }
    // 他 Character の Look を指すと、衣装だけ別人になった参照が Provider へ渡る。
    if (resolved.some((r) => r.look !== null && r.look.characterId !== r.entry.characterId)) {
      return { lookId: [FOREIGN_LOOK_MESSAGE] }
    }
    return null
  }

  const shotMissing = async (shotId: ShotId): Promise<boolean> =>
    (await deps.shots.findById(shotId)) === null

  return new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listShotCharactersRoute, async (c) => {
      const { shotId } = c.req.valid('param')
      if (await shotMissing(shotId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      return c.json(okList(await deps.shotCharacters.findByShot(shotId)), 200)
    })
    .openapi(replaceShotCharactersRoute, async (c) => {
      const { shotId } = c.req.valid('param')
      if (await shotMissing(shotId)) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const { entries } = c.req.valid('json')
      const fields = await invalidEntries(entries)
      if (fields !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, fields), 422)

      return c.json(okList(await deps.shotCharacters.replaceAll(shotId, entries)), 200)
    })
    .openapi(removeShotCharacterRoute, async (c) => {
      const { shotId, characterId } = c.req.valid('param')
      await deps.shotCharacters.remove(shotId, characterId)
      return c.body(null, 204)
    })
}
