import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  BrandAssetRepository,
  CharacterLookRepository,
  CharacterRepository,
  LocationRepository,
  ProjectRepository,
} from '@ixa/db'
import {
  BrandAssetId as BrandAssetIdSchema,
  CharacterId as CharacterIdSchema,
  LocationId as LocationIdSchema,
  ProjectId as ProjectIdSchema,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse, type FieldErrors } from '../response.js'
import { BrandAssetResponse, LocationResponse } from './assets.js'
import { CharacterResponse, toCharacterResponse } from './characters.js'
import { copyBrandAsset, copyCharacter, copyLocation } from '../library-copy.js'
import { sequentially } from '../sequentially.js'

/**
 * ほかのプロジェクトから取り込む（ADR-0034。制作者 2026-10-03「全プロジェクトで共有になっている。プロジェクト単位に
 * しないと大変なことになる」）。キャラクター・ロケーション・ブランド資産はプロジェクトごとなので、別のプロジェクトで
 * 使うときは**複製**する。
 *
 * - キャラクターは Look・同一性の画像・Look の画像・正面の絵ごと。画像のファイル（MediaAsset）は複製せず同じものを指す
 * - 複製した後は別物（片方を直しても、もう片方は変わらない）
 * - 同じワークスペースのものだけ（画像の保管庫がワークスペース単位のため）
 */

const MAX_IMPORT_ITEMS = 50

const ImportBody = z
  .object({
    characterIds: z.array(CharacterIdSchema).max(MAX_IMPORT_ITEMS).default([]),
    locationIds: z.array(LocationIdSchema).max(MAX_IMPORT_ITEMS).default([]),
    brandAssetIds: z.array(BrandAssetIdSchema).max(MAX_IMPORT_ITEMS).default([]),
  })
  .openapi('LibraryImportInput')

const ImportResult = z
  .object({
    characters: z.array(CharacterResponse),
    locations: z.array(LocationResponse),
    brandAssets: z.array(BrandAssetResponse),
  })
  .openapi('LibraryImportResult')

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const importRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/library-imports',
  tags: ['assets'],
  summary: 'ほかのプロジェクトのキャラクター・ロケーション・ブランド資産を複製して取り込む',
  request: {
    params: ProjectParams,
    body: { required: true, content: { 'application/json': { schema: ImportBody } } },
  },
  responses: {
    201: {
      description: '取り込んだもの（複製）',
      content: { 'application/json': { schema: successResponse(ImportResult) } },
    },
    404: errorContent('取り込み先のプロジェクトが存在しない'),
    422: errorContent('取り込めないものがある（何も作っていない）'),
    500: errorContent('サーバ内部エラー'),
  },
})

export type LibraryImportRoutesDeps = {
  readonly projects: Pick<ProjectRepository, 'findById'>
  readonly characters: Pick<CharacterRepository, 'findById' | 'create' | 'listIdentityImages' | 'addIdentityImage'>
  readonly looks: Pick<CharacterLookRepository, 'findByCharacter' | 'create' | 'listLookImages' | 'addLookImage'>
  readonly locations: Pick<LocationRepository, 'findById' | 'create'>
  readonly brandAssets: Pick<BrandAssetRepository, 'findById' | 'create'>
}

const NOTHING_MESSAGE = '取り込むものを選んでください'
const UNAVAILABLE_MESSAGE = '取り込めないものがあります（無いか、別のワークスペースのものです）'

/** 取り込めるものだけを引く。1 件でも無い・別のワークスペースなら null（何も作らない）。 */
const resolveAll = async <Id, T extends { readonly workspaceId: string }>(
  ids: readonly Id[],
  find: (id: Id) => Promise<T | null>,
  workspaceId: string,
): Promise<readonly T[] | null> => {
  const found: readonly (T | null)[] = await Promise.all(ids.map((id) => find(id)))
  const usable = found.filter((item): item is T => item !== null && item.workspaceId === workspaceId)
  return usable.length === ids.length ? usable : null
}

export const libraryImportRoutes = (deps: LibraryImportRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(importRoute, async (c) => {
    const project = await deps.projects.findById(c.req.valid('param').projectId)
    if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    const body = c.req.valid('json')
    if (body.characterIds.length + body.locationIds.length + body.brandAssetIds.length === 0) {
      return c.json(fail(VALIDATION_ERROR_MESSAGE, { characterIds: [NOTHING_MESSAGE] }), 422)
    }

    // **書く前に全部を確かめる。** 途中で断ると、半分だけ取り込んだ状態が残る。
    const [characters, locations, brandAssets] = await Promise.all([
      resolveAll(body.characterIds, (id) => deps.characters.findById(id), project.workspaceId),
      resolveAll(body.locationIds, (id) => deps.locations.findById(id), project.workspaceId),
      resolveAll(body.brandAssetIds, (id) => deps.brandAssets.findById(id), project.workspaceId),
    ])
    const fields: FieldErrors = {
      ...(characters === null ? { characterIds: [UNAVAILABLE_MESSAGE] } : {}),
      ...(locations === null ? { locationIds: [UNAVAILABLE_MESSAGE] } : {}),
      ...(brandAssets === null ? { brandAssetIds: [UNAVAILABLE_MESSAGE] } : {}),
    }
    if (characters === null || locations === null || brandAssets === null) {
      return c.json(fail(VALIDATION_ERROR_MESSAGE, fields), 422)
    }

    // 1 件ずつ順に作る（Look の既定の付け替えは作る順に依存する）。
    const copiedCharacters = await sequentially(characters, async (character) =>
      (await copyCharacter(deps, character, project)).character,
    )
    const copiedLocations = await sequentially(locations, (location) => copyLocation(deps, location, project))
    const copiedBrandAssets = await sequentially(brandAssets, (asset) => copyBrandAsset(deps, asset, project))

    return c.json(
      ok({
        characters: copiedCharacters.map(toCharacterResponse),
        locations: copiedLocations,
        brandAssets: copiedBrandAssets,
      }),
      201,
    )
  })
