import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import type {
  CharacterId, CharacterLook, CharacterLookId, CharacterLookImage, CharacterLookImageId,
  CreateCharacterLookImageInput, CreateCharacterLookInput, MediaAssetId, UpdateCharacterLookPatch,
} from '@ixa/domain'
import {
  CharacterLook as CharacterLookSchema,
  CharacterLookId as CharacterLookIdSchema,
  CharacterLookImage as CharacterLookImageSchema,
  CharacterLookImageId as CharacterLookImageIdSchema,
  CreateCharacterLookImageInput as CreateCharacterLookImageInputSchema,
  CreateCharacterLookInput as CreateCharacterLookInputSchema,
  UpdateCharacterLookPatch as UpdateCharacterLookPatchSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { characterLookImages, characterLooks } from '../schema/character.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type CharacterLookRow = typeof characterLooks.$inferSelect
export type CharacterLookImageRow = typeof characterLookImages.$inferSelect

/**
 * DOMAIN.md §5 の不変条件「Character は最低 1 つの isDefault な Look を持つ」を
 * 壊す操作を拒むときに投げる。呼び出し側は 422 へ変換する。
 */
export class CharacterLookInvariantError extends Error {
  override readonly name = 'CharacterLookInvariantError'
}

/**
 * CharacterLook（時系列で変わる外見）と Look 画像の読み書き。
 * 戻り値は必ず `@ixa/domain` の型。
 *
 * Look 画像はソフトデリートしない（CharacterRepository の識別画像と同じ理由）。
 */
export type CharacterLookRepository = {
  findById(id: CharacterLookId): Promise<CharacterLook | null>
  /** key 昇順。ソフトデリート済みは含まない。 */
  findByCharacter(characterId: CharacterId): Promise<CharacterLook[]>
  /** Shot は key で Look を指す。Character 内で一意。 */
  findByKey(characterId: CharacterId, key: string): Promise<CharacterLook | null>
  /**
   * その Character に Look が 1 つも無ければ isDefault を強制的に true にし、
   * isDefault で作られたときは同じ Character の他の Look を false に降格させる。
   */
  create(input: CreateCharacterLookInput): Promise<CharacterLook>
  update(id: CharacterLookId, patch: UpdateCharacterLookPatch): Promise<CharacterLook>
  /** 最後の Look は削除できない（CharacterLookInvariantError）。 */
  softDelete(id: CharacterLookId): Promise<void>

  /** order 昇順。 */
  listLookImages(lookId: CharacterLookId): Promise<CharacterLookImage[]>
  addLookImage(input: CreateCharacterLookImageInput): Promise<CharacterLookImage>
  removeLookImage(id: CharacterLookImageId): Promise<void>
  /** 承認 Take の 1 フレームを canonical reference へ昇格させる（ARCHITECTURE.md §8）。 */
  setCanonicalFrame(lookId: CharacterLookId, mediaAssetId: MediaAssetId): Promise<CharacterLook>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const characterLookRowToDomain = (row: CharacterLookRow): CharacterLook =>
  CharacterLookSchema.parse({
    id: row.id,
    characterId: row.characterId,
    key: row.key,
    name: row.name,
    era: row.era,
    description: row.description,
    wardrobeTokens: row.wardrobeTokens,
    styleTokens: row.styleTokens,
    colorPalette: row.colorPalette,
    isDefault: row.isDefault,
    canonicalFrameAssetId: row.canonicalFrameAssetId,
  })

export const characterLookImageRowToDomain = (row: CharacterLookImageRow): CharacterLookImage =>
  CharacterLookImageSchema.parse({
    id: row.id,
    lookId: row.lookId,
    mediaAssetId: row.mediaAssetId,
    role: row.role,
    isPrimary: row.isPrimary,
    order: row.order,
  })

const liveById = (id: CharacterLookId) =>
  and(eq(characterLooks.id, id), isNull(characterLooks.deletedAt))

const liveByCharacter = (characterId: CharacterId) =>
  and(eq(characterLooks.characterId, characterId), isNull(characterLooks.deletedAt))

const LAST_LOOK_MESSAGE =
  'Character は最低 1 つの Look を持つ必要があるため、最後の Look は削除できません'
const LAST_DEFAULT_MESSAGE =
  'Character は最低 1 つの isDefault な Look を持つ必要があるため、既定の Look を解除できません'

export const createCharacterLookRepository = (db: DbClient): CharacterLookRepository => ({
  async findById(id) {
    const rows = await db.select().from(characterLooks).where(liveById(id)).limit(1)
    const row = rows[0]
    return row ? characterLookRowToDomain(row) : null
  },

  async findByCharacter(characterId) {
    const rows = await db
      .select()
      .from(characterLooks)
      .where(liveByCharacter(characterId))
      .orderBy(asc(characterLooks.key))
    return rows.map(characterLookRowToDomain)
  },

  async findByKey(characterId, key) {
    const rows = await db
      .select()
      .from(characterLooks)
      .where(and(liveByCharacter(characterId), eq(characterLooks.key, key)))
      .limit(1)
    const row = rows[0]
    return row ? characterLookRowToDomain(row) : null
  },

  create(input) {
    const validated = CreateCharacterLookInputSchema.parse(input)
    const characterId = validated.characterId
    // 既定の切り替えと INSERT を 1 トランザクションにまとめる。
    // 途中で失敗すると既定の Look が 0 個または 2 個になるため。
    return db.transaction(async (tx) => {
      const siblings = await tx
        .select({ id: characterLooks.id })
        .from(characterLooks)
        .where(liveByCharacter(characterId))
      // 最初の Look は必ず既定にする（DOMAIN.md §5 の不変条件）
      const isDefault = siblings.length === 0 ? true : validated.isDefault
      if (isDefault) {
        await tx.update(characterLooks).set({ isDefault: false }).where(liveByCharacter(characterId))
      }
      const rows = await tx
        .insert(characterLooks)
        .values({ ...validated, isDefault, id: newId(CharacterLookIdSchema) })
        .returning()
      const row = rows[0]
      if (!row) throw new Error('character_looks への INSERT が行を返しませんでした')
      return characterLookRowToDomain(row)
    })
  },

  update(id, patch) {
    const validated = UpdateCharacterLookPatchSchema.parse(patch)
    return db.transaction(async (tx) => {
      const current = await tx.select().from(characterLooks).where(liveById(id)).limit(1)
      const target = current[0]
      if (!target) throw new DbNotFoundError('CharacterLook', id)
      // branded ID を得るため Domain へ写してから使う（row の characterId は素の string）
      const before = characterLookRowToDomain(target)

      if (validated.isDefault === true) {
        await tx
          .update(characterLooks)
          .set({ isDefault: false })
          .where(and(liveByCharacter(before.characterId), ne(characterLooks.id, id)))
      }
      // 既定を外すと「最低 1 つの isDefault」が崩れる。他を既定にしてから外させる。
      if (validated.isDefault === false && before.isDefault) {
        throw new CharacterLookInvariantError(LAST_DEFAULT_MESSAGE)
      }

      const rows = await tx.update(characterLooks).set(validated).where(liveById(id)).returning()
      const row = rows[0]
      if (!row) throw new DbNotFoundError('CharacterLook', id)
      return characterLookRowToDomain(row)
    })
  },

  softDelete(id) {
    return db.transaction(async (tx) => {
      const current = await tx.select().from(characterLooks).where(liveById(id)).limit(1)
      const target = current[0]
      if (!target) throw new DbNotFoundError('CharacterLook', id)
      const before = characterLookRowToDomain(target)

      const siblings = await tx
        .select({ id: characterLooks.id })
        .from(characterLooks)
        .where(and(liveByCharacter(before.characterId), ne(characterLooks.id, id)))
        .orderBy(asc(characterLooks.key))
      if (siblings.length === 0) throw new CharacterLookInvariantError(LAST_LOOK_MESSAGE)

      await tx.update(characterLooks).set({ deletedAt: new Date() }).where(liveById(id))

      // 既定を消したら残りの先頭を昇格させ、不変条件を保つ。
      const next = siblings[0]
      if (before.isDefault && next) {
        await tx.update(characterLooks).set({ isDefault: true }).where(eq(characterLooks.id, next.id))
      }
    })
  },

  async listLookImages(lookId) {
    const rows = await db
      .select()
      .from(characterLookImages)
      .where(eq(characterLookImages.lookId, lookId))
      .orderBy(asc(characterLookImages.order), asc(characterLookImages.id))
    return rows.map(characterLookImageRowToDomain)
  },

  async addLookImage(input) {
    const validated = CreateCharacterLookImageInputSchema.parse(input)
    const rows = await db
      .insert(characterLookImages)
      .values({ ...validated, id: newId(CharacterLookImageIdSchema) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('character_look_images への INSERT が行を返しませんでした')
    return characterLookImageRowToDomain(row)
  },

  async removeLookImage(id) {
    const rows = await db
      .delete(characterLookImages)
      .where(eq(characterLookImages.id, id))
      .returning({ id: characterLookImages.id })
    if (rows.length === 0) throw new DbNotFoundError('CharacterLookImage', id)
  },

  async setCanonicalFrame(lookId, mediaAssetId) {
    const rows = await db
      .update(characterLooks)
      .set({ canonicalFrameAssetId: mediaAssetId })
      .where(liveById(lookId))
      .returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('CharacterLook', lookId)
    return characterLookRowToDomain(row)
  },
})
