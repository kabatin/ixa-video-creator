import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  CharacterLookRepository, CharacterRepository, MediaAssetRepository, ProjectRepository,
  ShotCharacterRepository, ShotRepository,
} from '@ixa/db'
import {
  Character as CharacterSchema,
  CharacterId as CharacterIdSchema,
  CreateCharacterInput as CreateCharacterInputSchema,
  DEFAULT_LOOK,
  ProjectId as ProjectIdSchema,
  ShotCharacter as ShotCharacterSchema,
  ShotId as ShotIdSchema,
  UpdateCharacterPatch as UpdateCharacterPatchSchema,
  type Character,
  type Shot,
  type ShotId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import {
  errorContent, fail, listResponse, ok, okList, successResponse, type FieldErrors,
} from '../response.js'
import { identityImageRoutes } from './character-identity-images.js'
import { lookRoutes } from './character-looks.js'
import { FOREIGN_CHARACTER_MESSAGE } from './library-ownership.js'

/**
 * Character の CRUD（DOMAIN.md §5 / ARCHITECTURE.md §8）と、
 * 識別画像・Look のルートをまとめて 1 つのルータへ載せる組み立て。
 * ADR-0006 に従い zod スキーマとハンドラを 1 ファイルに同居させる。
 */

export const CharacterResponse = CharacterSchema.omit({ createdAt: true })
  .extend({ createdAt: z.string().datetime() })
  .openapi('Character')
export type CharacterResponse = z.infer<typeof CharacterResponse>

export const toCharacterResponse = (character: Character): CharacterResponse => ({
  ...character,
  createdAt: character.createdAt.toISOString(),
})

/** 呼び出し側から見た公開 API を分割前と同じに保つための再輸出。 */
export { IdentityImageResponse } from './character-identity-images.js'
export { LookImageResponse, LookResponse } from './character-looks.js'

/**
 * プロジェクトとワークスペースは本文に入れない。プロジェクトは経路が持ち、ワークスペースはそのプロジェクトから引く
 * （キャラクターはプロジェクトごと。ADR-0034）。正が 2 つになるのを避ける。
 */
const CreateCharacterBody = CreateCharacterInputSchema.omit({ workspaceId: true, projectId: true }).openapi(
  'CreateCharacterInput',
)
const UpdateCharacterBody = UpdateCharacterPatchSchema.openapi('UpdateCharacterPatch')

const pathId = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ id: schema.openapi({ param: { name: 'id', in: 'path' } }) })

const CharacterParams = pathId(CharacterIdSchema)
const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
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

const body = <T extends z.ZodTypeAny>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
})

const listCharactersRoute = createRoute({
  method: 'get', path: '/projects/{projectId}/characters', tags: ['characters'],
  summary: 'プロジェクトの Character 一覧',
  request: { params: ProjectParams },
  responses: { 200: jsonContent('Character 一覧', listResponse(CharacterResponse)), ...commonErrors },
})

const createCharacterRoute = createRoute({
  method: 'post', path: '/projects/{projectId}/characters', tags: ['characters'],
  summary: 'プロジェクトに Character を作成する',
  request: { params: ProjectParams, body: body(CreateCharacterBody) },
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

export type CharacterRoutesDeps = {
  characters: CharacterRepository
  looks: CharacterLookRepository
  /** 参照する MediaAsset の実在確認だけに使う。 */
  mediaAssets: MediaAssetRepository
  /** 一覧・作成の持ち主の確認と、ワークスペースを引くために使う。 */
  projects: Pick<ProjectRepository, 'findById'>
}

export const characterRoutes = (deps: CharacterRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook })
    .openapi(listCharactersRoute, async (c) => {
      const { projectId } = c.req.valid('param')
      if ((await deps.projects.findById(projectId)) === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const found = await deps.characters.findByProject(projectId)
      return c.json(okList(found.map(toCharacterResponse)), 200)
    })
    .openapi(createCharacterRoute, async (c) => {
      const project = await deps.projects.findById(c.req.valid('param').projectId)
      if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)
      const created = await deps.characters.create({
        ...c.req.valid('json'),
        workspaceId: project.workspaceId,
        projectId: project.id,
      })
      // 既定の Look も作る（DOMAIN.md §5）。無いと Shot の登場人物に入れられない（Look は必須）。
      await deps.looks.create({ characterId: created.id, ...DEFAULT_LOOK, isDefault: true })
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
    // 識別画像と Look は Character 配下の経路なので、同じルータに mount して
    // 呼び出し側が 1 つの factory を app.route するだけで済むようにする。
    .route('/', identityImageRoutes(deps))
    .route('/', lookRoutes(deps))

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
    shot: Shot,
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
    if (resolved.some((r) => r.character !== null && r.character.projectId !== shot.projectId)) {
      return { characterId: [FOREIGN_CHARACTER_MESSAGE] }
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
      const shot = await deps.shots.findById(shotId)
      if (shot === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

      const { entries } = c.req.valid('json')
      const fields = await invalidEntries(shot, entries)
      if (fields !== null) return c.json(fail(VALIDATION_ERROR_MESSAGE, fields), 422)

      return c.json(okList(await deps.shotCharacters.replaceAll(shotId, entries)), 200)
    })
    .openapi(removeShotCharacterRoute, async (c) => {
      const { shotId, characterId } = c.req.valid('param')
      await deps.shotCharacters.remove(shotId, characterId)
      return c.body(null, 204)
    })
}
