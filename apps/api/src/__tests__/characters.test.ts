import { OpenAPIHono } from '@hono/zod-openapi'
import {
  CharacterId as CharacterIdSchema,
  CharacterIdentityImageId as CharacterIdentityImageIdSchema,
  CharacterLookId as CharacterLookIdSchema,
  MediaAsset as MediaAssetSchema,
  MediaAssetId as MediaAssetIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type MediaAsset,
  type WorkspaceId,
} from '@ixa/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import {
  characterRoutes,
  type CharacterResponse,
  type CharacterRoutesDeps,
} from '../routes/characters.js'
import {
  createInMemoryCharacterLookRepository,
  createInMemoryCharacterRepository,
  createInMemoryMediaAssetRepository,
  type InMemoryCharacterLookRepository,
  type InMemoryCharacterRepository,
} from '@ixa/generation/testing'
import { aProject } from './fixtures.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'

type SuccessBody<T> = { success: true; data: T }
type ListBody<T> = { success: true; data: T[]; meta: { total: number } }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }

type LookBody = {
  id: string
  characterId: string
  key: string
  isDefault: boolean
  canonicalFrameAssetId: string | null
}
type ImageBody = { id: string; role: string; isPrimary: boolean; mediaAssetId: string }

/** テスト用の画像 MediaAsset。参照先が実在することを示すためだけに使う。 */
const anImageAsset = (workspaceId: WorkspaceId): MediaAsset =>
  MediaAssetSchema.parse({
    id: newId(MediaAssetIdSchema),
    workspaceId,
    projectId: null,
    kind: 'image',
    storageKey: `${workspaceId}/identity.png`,
    mimeType: 'image/png',
    bytes: 2048,
    checksumSha256: 'b'.repeat(64),
    probe: null,
    proxyKey: null,
    thumbnailKey: null,
    posterKeys: [],
    lastFrameAssetId: null,
    origin: { type: 'upload', uploadedBy: 'tester' },
    tags: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })

const workspaceId = WorkspaceIdSchema.parse(newId(WorkspaceIdSchema))
/** キャラクターはプロジェクトごと（ADR-0034）。同じワークスペースにプロジェクトを 2 つ置く。 */
const project = aProject({ workspaceId })
const otherProject = aProject({ workspaceId, name: 'LUNA BREW 30秒CM' })

let characters: InMemoryCharacterRepository
let looks: InMemoryCharacterLookRepository
let assets: readonly MediaAsset[]

const buildApp = (deps: CharacterRoutesDeps) => {
  const app = new OpenAPIHono({ defaultHook: validationHook })
  app.route('/', characterRoutes(deps))
  registerErrorHandlers(app, createLogger('silent'))
  return app
}

let app: ReturnType<typeof buildApp>

const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

/** Character を 1 体作り、その ID を返す。 */
const createCharacter = async (): Promise<string> => {
  const res = await send('POST', `/projects/${project.id}/characters`, {
    name: 'takepi',
    displayName: '藤本タケピ',
    identityAnchors: ['切れ長の目'],
  })
  const created = await json<SuccessBody<CharacterResponse>>(res)
  return created.data.id
}

const createLook = (characterId: string, overrides: Record<string, unknown> = {}) =>
  send('POST', `/characters/${characterId}/looks`, {
    key: 'IXA_CUP_PAST',
    name: 'iXA CUP 2019 当時',
    wardrobeTokens: ['黒髪短髪'],
    ...overrides,
  })

beforeEach(() => {
  characters = createInMemoryCharacterRepository()
  looks = createInMemoryCharacterLookRepository()
  assets = [anImageAsset(workspaceId), anImageAsset(workspaceId)]
  app = buildApp({
    characters,
    looks,
    mediaAssets: createInMemoryMediaAssetRepository(assets),
    projects: createInMemoryProjectRepository([project, otherProject]),
  })
})

/**
 * キャラクターはプロジェクトごと（制作者 2026-10-03「全プロジェクトで共有になっている。プロジェクト単位にしないと
 * 大変なことになる」）。一覧と作成はプロジェクトの経路で、ワークスペースで引く口は無い。
 */
describe('Character はプロジェクトごと', () => {
  it('作るとパスのプロジェクトに入り、ワークスペースはプロジェクトから入る', async () => {
    const id = await createCharacter()

    const one = await json<SuccessBody<CharacterResponse>>(await send('GET', `/characters/${id}`))
    expect(one.data.projectId).toBe(project.id)
    expect(one.data.workspaceId).toBe(workspaceId)
  })

  it('一覧はそのプロジェクトのものだけ。同じワークスペースのほかのプロジェクトには出ない', async () => {
    await createCharacter()

    const own = await json<ListBody<CharacterResponse>>(await send('GET', `/projects/${project.id}/characters`))
    const other = await json<ListBody<CharacterResponse>>(await send('GET', `/projects/${otherProject.id}/characters`))
    expect(own.meta.total).toBe(1)
    expect(other.meta.total).toBe(0)
  })

  it('無いプロジェクトは 404。ワークスペースで引く口は無い', async () => {
    const missing = aProject()
    expect((await send('GET', `/projects/${missing.id}/characters`)).status).toBe(404)
    expect((await send('POST', `/projects/${missing.id}/characters`, { name: 'x', displayName: 'x' })).status).toBe(404)
    expect((await send('GET', `/characters?workspaceId=${workspaceId}`)).status).toBe(404)
  })
})

/**
 * 作ると既定の Look「基本」も一緒にできる（DOMAIN.md §5「Character は最低 1 つの isDefault な Look を持つ」）。
 * 以前は Look の無いキャラクターができ、Shot の登場人物に入れられなかった（Look は必須）。画像だけで登録した戦子が
 * どの Shot にも入らず、最初のフレームが参照画像なしで作られて資料と違う見た目になった（制作者 2026-10-04）。
 */
describe('作ったキャラクターの既定の Look', () => {
  it('作ると既定の Look「基本」が 1 つできる', async () => {
    const characterId = await createCharacter()

    const list = await json<ListBody<LookBody & { name: string }>>(await send('GET', `/characters/${characterId}/looks`))
    expect(list.data).toHaveLength(1)
    expect(list.data[0]).toMatchObject({ name: '基本', key: 'BASE', isDefault: true })
  })
})

describe('Character の CRUD', () => {
  it('201 で作成し、一覧と 1 件取得で読み戻せる', async () => {
    const id = await createCharacter()

    const list = await json<ListBody<CharacterResponse>>(
      await send('GET', `/projects/${project.id}/characters`),
    )
    expect(list.meta.total).toBe(1)
    expect(list.data[0]?.displayName).toBe('藤本タケピ')

    const one = await json<SuccessBody<CharacterResponse>>(await send('GET', `/characters/${id}`))
    expect(one.data.identityAnchors).toEqual(['切れ長の目'])
    expect(CharacterIdSchema.safeParse(one.data.id).success).toBe(true)
  })

  it('PATCH で部分更新でき、DELETE は 204 でソフトデリートする', async () => {
    const id = await createCharacter()

    const patched = await json<SuccessBody<CharacterResponse>>(
      await send('PATCH', `/characters/${id}`, { displayName: '藤本タケピ（2026）' }),
    )
    expect(patched.data.displayName).toBe('藤本タケピ（2026）')

    expect((await send('DELETE', `/characters/${id}`)).status).toBe(204)
    expect(characters.snapshot()).toHaveLength(0)
    expect((await send('GET', `/characters/${id}`)).status).toBe(404)
  })

  it('存在しない Character は 404', async () => {
    const missing = newId(CharacterIdSchema)
    expect((await send('GET', `/characters/${missing}`)).status).toBe(404)
    expect((await send('PATCH', `/characters/${missing}`, { name: 'x' })).status).toBe(404)
    expect((await send('GET', `/characters/${missing}/looks`)).status).toBe(404)
  })
})

describe('CharacterLook の不変条件（DOMAIN.md §5）', () => {
  it('足した Look は isDefault を渡さなければ既定にならない（既定は作ったときの「基本」のまま）', async () => {
    const characterId = await createCharacter()
    const res = await createLook(characterId)

    expect(res.status).toBe(201)
    const created = await json<SuccessBody<LookBody>>(res)
    expect(created.data.isDefault).toBe(false)
    const list = await json<ListBody<LookBody>>(await send('GET', `/characters/${characterId}/looks`))
    expect(list.data.filter((l) => l.isDefault).map((l) => l.key)).toEqual(['BASE'])
  })

  it('2 つ目を isDefault: true で作ると 1 つ目が false になる', async () => {
    const characterId = await createCharacter()
    const first = await json<SuccessBody<LookBody>>(await createLook(characterId))

    const second = await json<SuccessBody<LookBody>>(
      await createLook(characterId, { key: 'SFL_CURRENT', name: 'SFL 現在', isDefault: true }),
    )
    expect(second.data.isDefault).toBe(true)

    const list = await json<ListBody<LookBody>>(
      await send('GET', `/characters/${characterId}/looks`),
    )
    expect(list.data.find((l) => l.id === first.data.id)?.isDefault).toBe(false)
    expect(list.data.filter((l) => l.isDefault)).toHaveLength(1)
  })

  it('最後の Look を削除しようとすると 422 で理由を返す', async () => {
    const characterId = await createCharacter()
    const [only] = (await json<ListBody<LookBody>>(await send('GET', `/characters/${characterId}/looks`))).data

    const res = await send('DELETE', `/looks/${only?.id ?? ''}`)
    expect(res.status).toBe(422)
    const error = await json<ErrorBody>(res)
    expect(error.error).toContain('最後の Look は削除できません')
    expect(looks.snapshot()).toHaveLength(1)
  })

  it('2 つあれば削除でき、既定が消えたら残りが既定に昇格する', async () => {
    const characterId = await createCharacter()
    const [base] = (await json<ListBody<LookBody>>(await send('GET', `/characters/${characterId}/looks`))).data
    await createLook(characterId, { key: 'SFL_CURRENT', name: 'SFL 現在' })

    expect((await send('DELETE', `/looks/${base?.id ?? ''}`)).status).toBe(204)

    const list = await json<ListBody<LookBody>>(
      await send('GET', `/characters/${characterId}/looks`),
    )
    expect(list.data).toHaveLength(1)
    expect(list.data[0]?.isDefault).toBe(true)
  })

  it('同じ Character 内で key が重複すると 409', async () => {
    const characterId = await createCharacter()
    await createLook(characterId)

    const res = await createLook(characterId, { name: '別名だが同じ key' })
    expect(res.status).toBe(409)
    expect((await json<ErrorBody>(res)).fields?.key).toBeDefined()
  })

  it('key の形式違反（小文字・記号）は 422', async () => {
    const characterId = await createCharacter()

    const res = await createLook(characterId, { key: 'ixa-cup-past' })
    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.key).toBeDefined()
  })

  it('存在しない Look は 404', async () => {
    const missing = newId(CharacterLookIdSchema)
    expect((await send('GET', `/looks/${missing}`)).status).toBe(404)
    expect((await send('DELETE', `/looks/${missing}`)).status).toBe(404)
    expect((await send('GET', `/looks/${missing}/images`)).status).toBe(404)
  })
})

describe('canonical frame', () => {
  it('設定が Look に反映される', async () => {
    const characterId = await createCharacter()
    const look = await json<SuccessBody<LookBody>>(await createLook(characterId))
    const frame = assets[0]?.id

    const res = await send('POST', `/looks/${look.data.id}/canonical-frame`, {
      mediaAssetId: frame,
    })
    expect(res.status).toBe(200)
    expect((await json<SuccessBody<LookBody>>(res)).data.canonicalFrameAssetId).toBe(frame)

    const reread = await json<SuccessBody<LookBody>>(await send('GET', `/looks/${look.data.id}`))
    expect(reread.data.canonicalFrameAssetId).toBe(frame)
  })

  it('存在しない MediaAsset は 422', async () => {
    const characterId = await createCharacter()
    const look = await json<SuccessBody<LookBody>>(await createLook(characterId))

    const res = await send('POST', `/looks/${look.data.id}/canonical-frame`, {
      mediaAssetId: newId(MediaAssetIdSchema),
    })
    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.mediaAssetId).toBeDefined()
  })
})

describe('識別画像', () => {
  const addImage = (characterId: string, mediaAssetId: string, extra: Record<string, unknown>) =>
    send('POST', `/characters/${characterId}/identity-images`, {
      mediaAssetId,
      order: 0,
      ...extra,
    })

  it('主画像の設定で、同じ role の他の画像だけ isPrimary が false になる', async () => {
    const characterId = await createCharacter()
    const [a, b] = assets
    const first = await json<SuccessBody<ImageBody>>(
      await addImage(characterId, String(a?.id), { role: 'four_view', isPrimary: true }),
    )
    const second = await json<SuccessBody<ImageBody>>(
      await addImage(characterId, String(b?.id), { role: 'four_view', order: 1 }),
    )
    const other = await json<SuccessBody<ImageBody>>(
      await addImage(characterId, String(a?.id), { role: 'face_front', isPrimary: true, order: 2 }),
    )

    const res = await send('POST', `/identity-images/${second.data.id}/primary`)
    expect(res.status).toBe(200)
    expect((await json<SuccessBody<ImageBody>>(res)).data.isPrimary).toBe(true)

    const list = await json<ListBody<ImageBody>>(
      await send('GET', `/characters/${characterId}/identity-images`),
    )
    expect(list.data.find((i) => i.id === first.data.id)?.isPrimary).toBe(false)
    expect(list.data.find((i) => i.id === second.data.id)?.isPrimary).toBe(true)
    // role が違う画像は影響を受けない
    expect(list.data.find((i) => i.id === other.data.id)?.isPrimary).toBe(true)
  })

  it('削除は 204、存在しない画像は 404', async () => {
    const characterId = await createCharacter()
    const image = await json<SuccessBody<ImageBody>>(
      await addImage(characterId, String(assets[0]?.id), { role: 'full_body' }),
    )

    expect((await send('DELETE', `/identity-images/${image.data.id}`)).status).toBe(204)
    expect(characters.images()).toHaveLength(0)

    const missing = newId(CharacterIdentityImageIdSchema)
    expect((await send('DELETE', `/identity-images/${missing}`)).status).toBe(404)
    expect((await send('POST', `/identity-images/${missing}/primary`)).status).toBe(404)
  })

  it('存在しない MediaAsset を参照すると 422', async () => {
    const characterId = await createCharacter()
    const res = await addImage(characterId, newId(MediaAssetIdSchema), { role: 'four_view' })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.mediaAssetId).toBeDefined()
  })
})

describe('Look 画像', () => {
  it('追加・一覧・削除ができる', async () => {
    const characterId = await createCharacter()
    const look = await json<SuccessBody<LookBody>>(await createLook(characterId))

    const created = await json<SuccessBody<ImageBody>>(
      await send('POST', `/looks/${look.data.id}/images`, {
        mediaAssetId: assets[0]?.id,
        role: 'wardrobe',
        isPrimary: true,
        order: 0,
      }),
    )
    const list = await json<ListBody<ImageBody>>(
      await send('GET', `/looks/${look.data.id}/images`),
    )
    expect(list.meta.total).toBe(1)

    expect((await send('DELETE', `/look-images/${created.data.id}`)).status).toBe(204)
    expect(looks.images()).toHaveLength(0)
  })
})
