import { OpenAPIHono } from '@hono/zod-openapi'
import { CharacterId as CharacterIdSchema, MediaAssetId as MediaAssetIdSchema, newId, type Project } from '@ixa/domain'
import {
  createInMemoryBrandAssetRepository,
  createInMemoryCharacterLookRepository,
  createInMemoryCharacterRepository,
  createInMemoryLocationRepository,
  type InMemoryBrandAssetRepository,
  type InMemoryCharacterLookRepository,
  type InMemoryCharacterRepository,
  type InMemoryLocationRepository,
} from '@ixa/generation/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { libraryImportRoutes } from '../routes/library-imports.js'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

/**
 * ほかのプロジェクトから取り込む（ADR-0034。制作者 2026-10-03「全プロジェクトで共有になっている。プロジェクト単位に
 * しないと大変なことになる」）。キャラクター・ロケーション・ブランド資産はプロジェクトごとなので、別のプロジェクトで
 * 使うときは複製する。キャラクターは Look・画像ごと。画像のファイルは複製せず同じものを指す。複製した後は別物。
 */

type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }
type ImportBody = {
  success: true
  data: {
    characters: { id: string; projectId: string; workspaceId: string; displayName: string }[]
    locations: { id: string; projectId: string; referenceAssetIds: string[] }[]
    brandAssets: { id: string; projectId: string; value: string | null }[]
  }
}

const image = (): ReturnType<typeof newId<typeof MediaAssetIdSchema>> => newId(MediaAssetIdSchema)

let source: Project
let target: Project
let elsewhere: Project
let characters: InMemoryCharacterRepository
let looks: InMemoryCharacterLookRepository
let locations: InMemoryLocationRepository
let brandAssets: InMemoryBrandAssetRepository
let app: OpenAPIHono

const post = (projectId: string, payload: unknown) =>
  app.request(`/projects/${projectId}/library-imports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

beforeEach(() => {
  source = aProject({ name: 'iXA CUP MUSIC VIDEO' })
  target = aProject({ workspaceId: source.workspaceId, name: 'iXA CUP MUSIC VIDEO（本制作）' })
  elsewhere = aProject({ name: '別のワークスペース' })
  characters = createInMemoryCharacterRepository()
  looks = createInMemoryCharacterLookRepository()
  locations = createInMemoryLocationRepository()
  brandAssets = createInMemoryBrandAssetRepository()
  app = new OpenAPIHono({ defaultHook: validationHook })
  app.route(
    '/',
    libraryImportRoutes({
      projects: createInMemoryProjectRepository([source, target, elsewhere]),
      characters,
      looks,
      locations,
      brandAssets,
    }),
  )
  registerErrorHandlers(app, createLogger('silent'))
})

/** タケピ（四面図・Look 2 つ。舞台衣装は既定で正面の絵と衣装の画像付き）。 */
const takepi = async (owner: Project = source) => {
  const character = await characters.create({
    workspaceId: owner.workspaceId,
    projectId: owner.id,
    name: 'takepi',
    displayName: '藤本タケピ',
    identityAnchors: ['切れ長の目'],
  })
  const fourView = image()
  await characters.addIdentityImage({ characterId: character.id, mediaAssetId: fourView, role: 'four_view', isPrimary: true, order: 0 })
  const canonical = image()
  const stage = await looks.create({
    characterId: character.id,
    key: 'STAGE_A',
    name: '舞台衣装',
    isDefault: true,
    canonicalFrameAssetId: canonical,
  })
  const wardrobe = image()
  await looks.addLookImage({ lookId: stage.id, mediaAssetId: wardrobe, role: 'wardrobe', isPrimary: true, order: 0 })
  await looks.create({ characterId: character.id, key: 'CASUAL', name: '私服' })
  return { character, fourView, canonical, wardrobe }
}

describe('POST /projects/{projectId}/library-imports', () => {
  it('キャラクターを Look・同一性の画像・Look の画像・正面の絵ごと複製する（画像は同じものを指す）', async () => {
    const original = await takepi()

    const res = await post(target.id, { characterIds: [original.character.id] })

    expect(res.status).toBe(201)
    const [copy] = ((await res.json()) as ImportBody).data.characters
    expect(copy).toMatchObject({ projectId: target.id, workspaceId: target.workspaceId, displayName: '藤本タケピ' })
    expect(copy?.id).not.toBe(original.character.id)
    const copyId = CharacterIdSchema.parse(copy?.id)
    expect((await characters.listIdentityImages(copyId)).map((i) => [i.mediaAssetId, i.role, i.isPrimary])).toEqual([
      [original.fourView, 'four_view', true],
    ])
    const copiedLooks = await looks.findByCharacter(copyId)
    expect(copiedLooks.map((l) => [l.key, l.isDefault, l.canonicalFrameAssetId]).sort()).toEqual(
      [
        ['CASUAL', false, null],
        ['STAGE_A', true, original.canonical],
      ].sort(),
    )
    const stage = copiedLooks.find((l) => l.key === 'STAGE_A')
    expect((await looks.listLookImages(stage?.id ?? ('' as never))).map((i) => i.mediaAssetId)).toEqual([original.wardrobe])
  })

  it('ロケーションとブランド資産も複製する', async () => {
    const reference = image()
    const venue = await locations.create({
      workspaceId: source.workspaceId, projectId: source.id, name: 'iXA CUP 会場', referenceAssetIds: [reference],
    })
    const yellow = await brandAssets.create({
      workspaceId: source.workspaceId, projectId: source.id, category: 'color', name: 'iXA Yellow', value: '#FFD200',
    })

    const res = await post(target.id, { locationIds: [venue.id], brandAssetIds: [yellow.id] })

    expect(res.status).toBe(201)
    const { data } = (await res.json()) as ImportBody
    expect(data.locations).toEqual([expect.objectContaining({ projectId: target.id, referenceAssetIds: [reference] })])
    expect(data.brandAssets).toEqual([expect.objectContaining({ projectId: target.id, value: '#FFD200' })])
    expect(await locations.findByProject(target.id)).toHaveLength(1)
    expect(await brandAssets.findByProject(target.id)).toHaveLength(1)
  })

  it('取り込んだ後は別物（元を直しても複製は変わらない）', async () => {
    const original = await takepi()
    const res = await post(target.id, { characterIds: [original.character.id] })
    const copyId = CharacterIdSchema.parse(((await res.json()) as ImportBody).data.characters[0]?.id)

    await characters.update(original.character.id, { displayName: '藤本タケピ（2026）' })

    expect((await characters.findById(copyId))?.displayName).toBe('藤本タケピ')
  })

  it('別のワークスペースのもの・無いものは断る（何も作らない）', async () => {
    const foreign = await takepi(elsewhere)

    const foreignRes = await post(target.id, { characterIds: [foreign.character.id] })
    const missingRes = await post(target.id, { characterIds: [newId(CharacterIdSchema)] })

    expect(foreignRes.status).toBe(422)
    expect(((await foreignRes.json()) as ErrorBody).fields?.characterIds).toBeDefined()
    expect(missingRes.status).toBe(422)
    expect(await characters.findByProject(target.id)).toEqual([])
  })

  it('何も選んでいなければ 422、無いプロジェクトへは 404', async () => {
    expect((await post(target.id, {})).status).toBe(422)
    expect((await post(aProject().id, { characterIds: [] })).status).toBe(404)
  })
})
