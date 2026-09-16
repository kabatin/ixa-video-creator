import { OpenAPIHono } from '@hono/zod-openapi'
import {
  CharacterId as CharacterIdSchema,
  ProjectId as ProjectIdSchema,
  WorkspaceId as WorkspaceIdSchema,
  newId,
  type Character,
  type CharacterLook,
  type Shot,
} from '@ixa/domain'
import {
  aShot,
  createInMemoryCharacterLookRepository,
  createInMemoryCharacterRepository,
  createInMemoryShotCharacterRepository,
  createInMemoryShotRepository,
  type InMemoryCharacterLookRepository,
  type InMemoryCharacterRepository,
  type InMemoryShotCharacterRepository,
} from '@ixa/generation/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import { shotCharacterRoutes, type ShotCharacterRoutesDeps } from '../routes/characters.js'

/**
 * Shot と Character の紐づけを扱う HTTP ルート。実 DB には接続しない。
 * 紐づけの読み出し順や参照解決そのものは packages/generation のユニットテストが見る。
 * ここが確かめるのは **HTTP の入口での検証とステータスコード**である。
 */

const workspaceId = newId(WorkspaceIdSchema)
const projectId = newId(ProjectIdSchema)

let characters: InMemoryCharacterRepository
let looks: InMemoryCharacterLookRepository
let shotCharacters: InMemoryShotCharacterRepository
let shot: Shot

/** Character と既定 Look を 1 組作る。 */
const registerCharacter = async (
  name: string,
): Promise<{ character: Character; look: CharacterLook }> => {
  const character = await characters.create({ workspaceId, name, displayName: name })
  const look = await looks.create({
    characterId: character.id,
    key: 'STAGE_A',
    name: `${name} のステージ衣装`,
  })
  return { character, look }
}

const link = (
  character: Character,
  look: CharacterLook,
  prominence: 'primary' | 'secondary' | 'background',
  order: number,
) => shotCharacters.add({ shotId: shot.id, characterId: character.id, lookId: look.id, prominence, order })

beforeEach(() => {
  characters = createInMemoryCharacterRepository()
  looks = createInMemoryCharacterLookRepository()
  shotCharacters = createInMemoryShotCharacterRepository()
  shot = aShot(projectId)
})

describe('PUT /shots/{shotId}/characters', () => {
  const buildApp = (deps: ShotCharacterRoutesDeps) => {
    const app = new OpenAPIHono({ defaultHook: validationHook })
    app.route('/', shotCharacterRoutes(deps))
    registerErrorHandlers(app, createLogger('silent'))
    return app
  }

  type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }
  type ListBody<T> = { success: true; data: T[]; meta: { total: number } }
  type ShotCharacterBody = { characterId: string; lookId: string; prominence: string; order: number }

  let app: ReturnType<typeof buildApp>

  beforeEach(() => {
    app = buildApp({
      shots: createInMemoryShotRepository([shot]),
      shotCharacters,
      characters,
      looks,
    })
  })

  const send = (method: string, path: string, payload?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })

  const json = async <T>(res: Response): Promise<T> => (await res.json()) as T

  it('一括置き換えに成功し、一覧で読み戻せる', async () => {
    const lead = await registerCharacter('takepi')
    const support = await registerCharacter('kana')

    const put = await send('PUT', `/shots/${shot.id}/characters`, {
      entries: [
        { characterId: lead.character.id, lookId: lead.look.id, prominence: 'primary', order: 0 },
        {
          characterId: support.character.id, lookId: support.look.id,
          prominence: 'background', order: 1,
        },
      ],
    })
    expect(put.status).toBe(200)

    const list = await json<ListBody<ShotCharacterBody>>(
      await send('GET', `/shots/${shot.id}/characters`),
    )
    expect(list.meta.total).toBe(2)
    expect(list.data[0]?.characterId).toBe(lead.character.id)
  })

  it('他 Character の Look を指定したら 422', async () => {
    const owner = await registerCharacter('takepi')
    const other = await registerCharacter('kana')

    const res = await send('PUT', `/shots/${shot.id}/characters`, {
      entries: [
        { characterId: owner.character.id, lookId: other.look.id, prominence: 'primary', order: 0 },
      ],
    })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.lookId).toBeDefined()
    expect(shotCharacters.snapshot()).toHaveLength(0)
  })

  it('同じ characterId が重複していたら 422', async () => {
    const { character, look } = await registerCharacter('takepi')

    const res = await send('PUT', `/shots/${shot.id}/characters`, {
      entries: [
        { characterId: character.id, lookId: look.id, prominence: 'primary', order: 0 },
        { characterId: character.id, lookId: look.id, prominence: 'secondary', order: 1 },
      ],
    })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.characterId).toBeDefined()
  })

  it('存在しない Character を指定したら 422', async () => {
    const { look } = await registerCharacter('takepi')

    const res = await send('PUT', `/shots/${shot.id}/characters`, {
      entries: [
        {
          characterId: newId(CharacterIdSchema), lookId: look.id,
          prominence: 'primary', order: 0,
        },
      ],
    })

    expect(res.status).toBe(422)
    expect((await json<ErrorBody>(res)).fields?.characterId).toBeDefined()
  })

  it('存在しない Shot は 404', async () => {
    const res = await send('PUT', `/shots/${aShot(projectId).id}/characters`, { entries: [] })
    expect(res.status).toBe(404)
  })

  it('DELETE で 1 人だけ外せる', async () => {
    const lead = await registerCharacter('takepi')
    const support = await registerCharacter('kana')
    await link(lead.character, lead.look, 'primary', 0)
    await link(support.character, support.look, 'secondary', 1)

    const res = await send('DELETE', `/shots/${shot.id}/characters/${lead.character.id}`)

    expect(res.status).toBe(204)
    expect(shotCharacters.snapshot().map((entry) => entry.characterId)).toEqual([
      support.character.id,
    ])
  })
})
