import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type {
  BrandAssetRepository,
  CharacterLookRepository,
  CharacterRepository,
  LocationRepository,
  MusicAnalysisRepository,
  MusicTrackRepository,
  ProjectRepository,
  SfxJobRepository,
  VoiceProfileRepository,
} from '@ixa/db'
import {
  BrandAssetId as BrandAssetIdSchema,
  CharacterId as CharacterIdSchema,
  LocationId as LocationIdSchema,
  MediaAssetId as MediaAssetIdSchema,
  MusicTrackId as MusicTrackIdSchema,
  ProjectId as ProjectIdSchema,
  SfxJobId as SfxJobIdSchema,
  VoiceProfileId as VoiceProfileIdSchema,
  type CharacterId,
} from '@ixa/domain'
import { NOT_FOUND_MESSAGE, VALIDATION_ERROR_MESSAGE, validationHook } from '../errors.js'
import { errorContent, fail, ok, successResponse, type FieldErrors } from '../response.js'
import { BrandAssetResponse, LocationResponse } from './assets.js'
import { CharacterResponse, toCharacterResponse } from './characters.js'
import { MusicTrackResponse } from './music.js'
import { VoiceProfileResponse, toVoiceResponse } from './narration-voices.js'
import { copyBrandAsset, copyCharacter, copyLocation, copyMusicTrack } from '../library-copy.js'
import { copyVoices, recordSfxSounds, resolveImport, type ImportSelection } from '../library-import-resolve.js'
import { sequentially } from '../sequentially.js'

/**
 * ほかのプロジェクトから取り込む（ADR-0034・ADR-0053。制作者 2026-10-03「全プロジェクトで共有になっている。
 * プロジェクト単位にしないと大変なことになる」、2026-10-19「素材ツリーにある各種項目の素材を他のプロジェクトから
 * 簡単にコピーできるといいなぁ」）。素材ツリーの段（キャラクター・ロケーション・ブランド資産・声・楽曲・効果音）は
 * プロジェクトごとなので、別のプロジェクトで使うときは**複製**する。
 *
 * - キャラクターは Look・同一性の画像・Look の画像・正面の絵ごと。画像・音のファイル（MediaAsset）は複製せず同じものを指す
 * - 声は設定を、楽曲は行と解析を、効果音は 1 本ずつ「置いていない候補」として複製する
 * - 複製した後は別物（片方を直しても、もう片方は変わらない）
 * - 同じワークスペースのものだけ（ファイルの保管庫がワークスペース単位のため）
 */

const MAX_IMPORT_ITEMS = 50

const SfxSoundRef = z
  .object({ sfxJobId: SfxJobIdSchema, mediaAssetId: MediaAssetIdSchema })
  .strict()
  .openapi('LibraryImportSfxSound')

const ImportBody = z
  .object({
    characterIds: z.array(CharacterIdSchema).max(MAX_IMPORT_ITEMS).default([]),
    locationIds: z.array(LocationIdSchema).max(MAX_IMPORT_ITEMS).default([]),
    brandAssetIds: z.array(BrandAssetIdSchema).max(MAX_IMPORT_ITEMS).default([]),
    voiceIds: z.array(VoiceProfileIdSchema).max(MAX_IMPORT_ITEMS).default([]),
    musicTrackIds: z.array(MusicTrackIdSchema).max(MAX_IMPORT_ITEMS).default([]),
    /** 効果音は 1 本ずつ（1 回のジョブで何本か作るので、ジョブとその音の組で指す）。 */
    sfxSounds: z.array(SfxSoundRef).max(MAX_IMPORT_ITEMS).default([]),
  })
  .openapi('LibraryImportInput')

const ImportResult = z
  .object({
    characters: z.array(CharacterResponse),
    locations: z.array(LocationResponse),
    brandAssets: z.array(BrandAssetResponse),
    voices: z.array(VoiceProfileResponse),
    musicTracks: z.array(MusicTrackResponse),
    /** 取り込み先に記した効果音（取り込み先のジョブと、同じ音）。 */
    sfxSounds: z.array(SfxSoundRef),
  })
  .openapi('LibraryImportResult')

const ProjectParams = z.object({
  projectId: ProjectIdSchema.openapi({ param: { name: 'projectId', in: 'path' } }),
})

const importRoute = createRoute({
  method: 'post',
  path: '/projects/{projectId}/library-imports',
  tags: ['assets'],
  summary: 'ほかのプロジェクトの素材（キャラクター・ロケーション・ブランド資産・声・楽曲・効果音）を複製して取り込む',
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
  readonly musicTracks: Pick<MusicTrackRepository, 'findById' | 'create'>
  readonly musicAnalyses: Pick<MusicAnalysisRepository, 'findByTrack' | 'findByTrackAndVersion' | 'create'>
  /** 声（ADR-0038）。繋いでいない環境では省く（そのとき声は取り込めない）。 */
  readonly voices?: Pick<VoiceProfileRepository, 'findById' | 'findByProject' | 'create'>
  /** 効果音（ADR-0052）。繋いでいない環境では省く（そのとき効果音は取り込めない）。 */
  readonly sfxJobs?: Pick<SfxJobRepository, 'findById' | 'recordImported'>
}

const NOTHING_MESSAGE = '取り込むものを選んでください'
const UNAVAILABLE_MESSAGE = '取り込めないものがあります（無いか、別のワークスペースのものです）'

const countOf = (selection: ImportSelection): number =>
  Object.values(selection).reduce((sum, ids: readonly unknown[]) => sum + ids.length, 0)

export const libraryImportRoutes = (deps: LibraryImportRoutesDeps) =>
  new OpenAPIHono({ defaultHook: validationHook }).openapi(importRoute, async (c) => {
    const project = await deps.projects.findById(c.req.valid('param').projectId)
    if (project === null) return c.json(fail(NOT_FOUND_MESSAGE), 404)

    const body = c.req.valid('json')
    if (countOf(body) === 0) {
      return c.json(fail(VALIDATION_ERROR_MESSAGE, { characterIds: [NOTHING_MESSAGE] }), 422)
    }

    // **書く前に全部を確かめる。** 途中で断ると、半分だけ取り込んだ状態が残る。
    const resolved = await resolveImport(deps, body, project.workspaceId, project.id)
    if (!resolved.ok) {
      const fields: FieldErrors = Object.fromEntries(resolved.failed.map((field) => [field, [UNAVAILABLE_MESSAGE]]))
      return c.json(fail(VALIDATION_ERROR_MESSAGE, fields), 422)
    }
    const { characters, locations, brandAssets, voices, musicTracks, sfxSounds } = resolved.value

    // 1 件ずつ順に作る（Look の既定の付け替えは作る順に依存する）。
    const copiedCharacters = await sequentially(characters, (character) => copyCharacter(deps, character, project))
    // 声は、同じ取り込みで写したキャラクターなら写した方を指す。
    const characterMap = new Map<CharacterId, CharacterId>(
      characters.flatMap((character, index) => {
        const copied = copiedCharacters[index]
        return copied === undefined ? [] : [[character.id, copied.character.id] as const]
      }),
    )
    const copiedLocations = await sequentially(locations, (location) => copyLocation(deps, location, project))
    const copiedBrandAssets = await sequentially(brandAssets, (asset) => copyBrandAsset(deps, asset, project))
    const copiedVoices = await copyVoices(deps, voices, project, characterMap)
    const copiedTracks = await sequentially(musicTracks, (track) => copyMusicTrack(deps, track, project))
    const recordedSfx = await recordSfxSounds(deps, sfxSounds)

    return c.json(
      ok({
        characters: copiedCharacters.map(({ character }) => toCharacterResponse(character)),
        locations: copiedLocations,
        brandAssets: copiedBrandAssets,
        voices: copiedVoices.map(toVoiceResponse),
        musicTracks: copiedTracks,
        sfxSounds: [...recordedSfx],
      }),
      201,
    )
  })
