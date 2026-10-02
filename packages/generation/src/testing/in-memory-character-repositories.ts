import {
  CharacterLookInvariantError, DbNotFoundError,
  type CharacterLookRepository, type CharacterRepository,
} from '@ixa/db'
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
  UpdateCharacterLookPatch as UpdateCharacterLookPatchSchema,
  UpdateCharacterPatch as UpdateCharacterPatchSchema,
  newId,
  type Character,
  type CharacterId,
  type CharacterIdentityImage,
  type CharacterIdentityImageId,
  type CharacterLook,
  type CharacterLookId,
  type CharacterLookImage,
} from '@ixa/domain'

/**
 * テスト用のインメモリ Character / CharacterLook リポジトリ。実 DB には接続しない。
 * Domain 型のみを返し、保持する値は毎回作り直す（破壊的変更をしない）。
 *
 * DOMAIN.md §5 の不変条件（既定 Look が常に 1 つ / 最後の Look は消せない）は
 * 本実装と同じ振る舞いをここでも再現する。これがずれると API の検証が意味を失う。
 */

export type InMemoryCharacterRepository = CharacterRepository & {
  readonly snapshot: () => readonly Character[]
  readonly images: () => readonly CharacterIdentityImage[]
}

export const createInMemoryCharacterRepository = (
  seed: readonly Character[] = [],
): InMemoryCharacterRepository => {
  let store: readonly Character[] = seed.map((c) => CharacterSchema.parse(c))
  let images: readonly CharacterIdentityImage[] = []

  const find = (id: CharacterId): Character | undefined => store.find((c) => c.id === id)

  return {
    snapshot: () => store,
    images: () => images,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByProject: (projectId) =>
      Promise.resolve(store.filter((c) => c.projectId === projectId)),

    create: (input) => {
      const validated = CreateCharacterInputSchema.parse(input)
      const created = CharacterSchema.parse({
        ...validated,
        id: newId(CharacterIdSchema),
        createdAt: new Date(),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('Character', id))
      const updated = CharacterSchema.parse({
        ...current,
        ...UpdateCharacterPatchSchema.parse(patch),
      })
      store = store.map((c) => (c.id === id ? updated : c))
      return Promise.resolve(updated)
    },

    softDelete: (id) => {
      if (find(id) === undefined) return Promise.reject(new DbNotFoundError('Character', id))
      store = store.filter((c) => c.id !== id)
      return Promise.resolve()
    },

    listIdentityImages: (characterId) =>
      Promise.resolve(
        images.filter((i) => i.characterId === characterId).sort((a, b) => a.order - b.order),
      ),

    findIdentityImageById: (id) => Promise.resolve(images.find((i) => i.id === id) ?? null),

    addIdentityImage: (input) => {
      const validated = CreateCharacterIdentityImageInputSchema.parse(input)
      const created = CharacterIdentityImageSchema.parse({
        ...validated,
        id: newId(CharacterIdentityImageIdSchema),
      })
      images = [...images, created]
      return Promise.resolve(created)
    },

    removeIdentityImage: (id) => {
      if (images.find((i) => i.id === id) === undefined) {
        return Promise.reject(new DbNotFoundError('CharacterIdentityImage', id))
      }
      images = images.filter((i) => i.id !== id)
      return Promise.resolve()
    },

    setPrimaryIdentityImage: (characterId: CharacterId, imageId: CharacterIdentityImageId, role) => {
      const target = images.find((i) => i.id === imageId && i.characterId === characterId)
      if (target === undefined || target.role !== role) {
        return Promise.reject(new DbNotFoundError('CharacterIdentityImage', imageId))
      }
      // 同じ role の主画像は 1 枚だけ
      images = images.map((image) =>
        image.characterId === characterId && image.role === role
          ? { ...image, isPrimary: image.id === imageId }
          : image,
      )
      return Promise.resolve({ ...target, isPrimary: true })
    },
  }
}

export type InMemoryCharacterLookRepository = CharacterLookRepository & {
  readonly snapshot: () => readonly CharacterLook[]
  readonly images: () => readonly CharacterLookImage[]
}

const LAST_LOOK_MESSAGE =
  'Character は最低 1 つの Look を持つ必要があるため、最後の Look は削除できません'
const LAST_DEFAULT_MESSAGE =
  'Character は最低 1 つの isDefault な Look を持つ必要があるため、既定の Look を解除できません'

export const createInMemoryCharacterLookRepository = (): InMemoryCharacterLookRepository => {
  let store: readonly CharacterLook[] = []
  let images: readonly CharacterLookImage[] = []

  const find = (id: CharacterLookId): CharacterLook | undefined => store.find((l) => l.id === id)
  const siblings = (characterId: CharacterId): readonly CharacterLook[] =>
    store.filter((l) => l.characterId === characterId)
  const demoteOthers = (characterId: CharacterId, keep: CharacterLookId): void => {
    store = store.map((look) =>
      look.characterId === characterId && look.id !== keep ? { ...look, isDefault: false } : look,
    )
  }

  return {
    snapshot: () => store,
    images: () => images,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByCharacter: (characterId) =>
      Promise.resolve([...siblings(characterId)].sort((a, b) => a.key.localeCompare(b.key))),

    findByKey: (characterId, key) =>
      Promise.resolve(siblings(characterId).find((l) => l.key === key) ?? null),

    create: (input) => {
      const validated = CreateCharacterLookInputSchema.parse(input)
      const characterId = validated.characterId
      // 最初の Look は必ず既定になる（DOMAIN.md §5）
      const isDefault = siblings(characterId).length === 0 ? true : validated.isDefault
      const created = CharacterLookSchema.parse({
        ...validated,
        isDefault,
        id: newId(CharacterLookIdSchema),
      })
      store = [...store, created]
      if (isDefault) demoteOthers(characterId, created.id)
      return Promise.resolve(created)
    },

    update: (id, patch) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('CharacterLook', id))
      const validated = UpdateCharacterLookPatchSchema.parse(patch)
      if (validated.isDefault === false && current.isDefault) {
        return Promise.reject(new CharacterLookInvariantError(LAST_DEFAULT_MESSAGE))
      }
      const updated = CharacterLookSchema.parse({ ...current, ...validated })
      store = store.map((look) => (look.id === id ? updated : look))
      if (validated.isDefault === true) demoteOthers(current.characterId, id)
      return Promise.resolve(updated)
    },

    softDelete: (id) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('CharacterLook', id))
      const rest = siblings(current.characterId).filter((l) => l.id !== id)
      if (rest.length === 0) return Promise.reject(new CharacterLookInvariantError(LAST_LOOK_MESSAGE))
      store = store.filter((look) => look.id !== id)
      // 既定を消したら残りの先頭を昇格させる
      const next = [...rest].sort((a, b) => a.key.localeCompare(b.key))[0]
      if (current.isDefault && next !== undefined) {
        store = store.map((look) => (look.id === next.id ? { ...look, isDefault: true } : look))
      }
      return Promise.resolve()
    },

    listLookImages: (lookId) =>
      Promise.resolve(images.filter((i) => i.lookId === lookId).sort((a, b) => a.order - b.order)),

    addLookImage: (input) => {
      const validated = CreateCharacterLookImageInputSchema.parse(input)
      const created = CharacterLookImageSchema.parse({
        ...validated,
        id: newId(CharacterLookImageIdSchema),
      })
      images = [...images, created]
      return Promise.resolve(created)
    },

    removeLookImage: (id) => {
      if (images.find((i) => i.id === id) === undefined) {
        return Promise.reject(new DbNotFoundError('CharacterLookImage', id))
      }
      images = images.filter((i) => i.id !== id)
      return Promise.resolve()
    },

    setCanonicalFrame: (lookId, mediaAssetId) => {
      const current = find(lookId)
      if (current === undefined) return Promise.reject(new DbNotFoundError('CharacterLook', lookId))
      const updated = CharacterLookSchema.parse({ ...current, canonicalFrameAssetId: mediaAssetId })
      store = store.map((look) => (look.id === lookId ? updated : look))
      return Promise.resolve(updated)
    },
  }
}
