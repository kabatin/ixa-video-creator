/**
 * テスト用のインメモリ ShotCharacter / ShotReference リポジトリ。実 DB には接続しない。
 * Domain 型のみを返し、保持する値は毎回作り直す（破壊的変更をしない）。
 */
import {
  DbNotFoundError,
  type ShotCharacterRepository,
  type ShotReferenceRepository,
} from '@ixa/db'
import {
  CreateShotReferenceInput as CreateShotReferenceInputSchema,
  ShotCharacter as ShotCharacterSchema,
  ShotReference as ShotReferenceSchema,
  ShotReferenceId as ShotReferenceIdSchema,
  newId,
  type ShotCharacter,
  type ShotReference,
} from '@ixa/domain'

export type InMemoryShotCharacterRepository = ShotCharacterRepository & {
  readonly snapshot: () => readonly ShotCharacter[]
}

const byOrderThenCharacterId = (a: ShotCharacter, b: ShotCharacter): number =>
  a.order - b.order || (a.characterId < b.characterId ? -1 : 1)

export const createInMemoryShotCharacterRepository = (
  seed: readonly ShotCharacter[] = [],
): InMemoryShotCharacterRepository => {
  let store: readonly ShotCharacter[] = seed.map((entry) => ShotCharacterSchema.parse(entry))

  return {
    snapshot: () => store,

    findByShot: (shotId) =>
      Promise.resolve(store.filter((e) => e.shotId === shotId).sort(byOrderThenCharacterId)),

    add: (input) => {
      const created = ShotCharacterSchema.parse(input)
      store = [...store, created]
      return Promise.resolve(created)
    },

    remove: (shotId, characterId) => {
      const target = store.find((e) => e.shotId === shotId && e.characterId === characterId)
      if (target === undefined) {
        return Promise.reject(new DbNotFoundError('ShotCharacter', characterId))
      }
      store = store.filter((e) => !(e.shotId === shotId && e.characterId === characterId))
      return Promise.resolve()
    },

    replaceAll: (shotId, entries) => {
      const created = entries.map((entry) => ShotCharacterSchema.parse({ ...entry, shotId }))
      store = [...store.filter((e) => e.shotId !== shotId), ...created]
      return Promise.resolve([...created].sort(byOrderThenCharacterId))
    },
  }
}

export type InMemoryShotReferenceRepository = ShotReferenceRepository & {
  readonly snapshot: () => readonly ShotReference[]
}

export const createInMemoryShotReferenceRepository = (): InMemoryShotReferenceRepository => {
  let store: readonly ShotReference[] = []

  return {
    snapshot: () => store,

    findByShot: (shotId) =>
      Promise.resolve(store.filter((r) => r.shotId === shotId).sort((a, b) => a.order - b.order)),

    create: (input) => {
      const created = ShotReferenceSchema.parse({
        ...CreateShotReferenceInputSchema.parse(input),
        id: newId(ShotReferenceIdSchema),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    delete: (id) => {
      if (store.find((r) => r.id === id) === undefined) {
        return Promise.reject(new DbNotFoundError('ShotReference', id))
      }
      store = store.filter((r) => r.id !== id)
      return Promise.resolve()
    },
  }
}
