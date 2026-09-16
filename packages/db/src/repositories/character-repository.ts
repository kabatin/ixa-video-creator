import { and, asc, eq, isNull } from 'drizzle-orm'
import type {
  Character, CharacterId, CharacterIdentityImage, CharacterIdentityImageId,
  CreateCharacterIdentityImageInput, CreateCharacterInput, IdentityImageRole,
  UpdateCharacterPatch, WorkspaceId,
} from '@ixa/domain'
import {
  Character as CharacterSchema,
  CharacterId as CharacterIdSchema,
  CharacterIdentityImage as CharacterIdentityImageSchema,
  CharacterIdentityImageId as CharacterIdentityImageIdSchema,
  CreateCharacterIdentityImageInput as CreateCharacterIdentityImageInputSchema,
  CreateCharacterInput as CreateCharacterInputSchema,
  UpdateCharacterPatch as UpdateCharacterPatchSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { characterIdentityImages, characters } from '../schema/character.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type CharacterRow = typeof characters.$inferSelect
export type CharacterIdentityImageRow = typeof characterIdentityImages.$inferSelect

/**
 * Character（同一性のみ）と識別画像の読み書き。戻り値は必ず `@ixa/domain` の型。
 * 時系列で変わる外見は CharacterLookRepository が持つ（DOMAIN.md §5）。
 *
 * 識別画像はソフトデリートしない。character_identity_images は制作物ではなく
 * MediaAsset への参照表であり、履歴を残す意味がないため物理削除する。
 */
export type CharacterRepository = {
  findById(id: CharacterId): Promise<Character | null>
  /** 作成順（ULID 昇順）。ソフトデリート済みは含まない。 */
  findByWorkspace(workspaceId: WorkspaceId): Promise<Character[]>
  create(input: CreateCharacterInput): Promise<Character>
  update(id: CharacterId, patch: UpdateCharacterPatch): Promise<Character>
  softDelete(id: CharacterId): Promise<void>

  /** order 昇順。 */
  listIdentityImages(characterId: CharacterId): Promise<CharacterIdentityImage[]>
  /**
   * 1 件取得。`POST /identity-images/:id/primary` は画像 ID しか持たないため、
   * characterId と role を引くのにこれが要る。
   */
  findIdentityImageById(id: CharacterIdentityImageId): Promise<CharacterIdentityImage | null>
  addIdentityImage(input: CreateCharacterIdentityImageInput): Promise<CharacterIdentityImage>
  removeIdentityImage(id: CharacterIdentityImageId): Promise<void>
  /** 指定画像を主画像にし、**同じ role の他の画像の isPrimary を false にする**。 */
  setPrimaryIdentityImage(
    characterId: CharacterId,
    imageId: CharacterIdentityImageId,
    role: IdentityImageRole,
  ): Promise<CharacterIdentityImage>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const characterRowToDomain = (row: CharacterRow): Character =>
  CharacterSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    identityAnchors: row.identityAnchors,
    styleTokens: row.styleTokens,
    colorPalette: row.colorPalette,
    createdAt: row.createdAt,
  })

export const identityImageRowToDomain = (row: CharacterIdentityImageRow): CharacterIdentityImage =>
  CharacterIdentityImageSchema.parse({
    id: row.id,
    characterId: row.characterId,
    mediaAssetId: row.mediaAssetId,
    role: row.role,
    isPrimary: row.isPrimary,
    order: row.order,
  })

const liveById = (id: CharacterId) => and(eq(characters.id, id), isNull(characters.deletedAt))

export const createCharacterRepository = (db: DbClient): CharacterRepository => ({
  async findById(id) {
    const rows = await db.select().from(characters).where(liveById(id)).limit(1)
    const row = rows[0]
    return row ? characterRowToDomain(row) : null
  },

  async findByWorkspace(workspaceId) {
    const rows = await db
      .select()
      .from(characters)
      .where(and(eq(characters.workspaceId, workspaceId), isNull(characters.deletedAt)))
      .orderBy(asc(characters.id))
    return rows.map(characterRowToDomain)
  },

  async create(input) {
    const validated = CreateCharacterInputSchema.parse(input)
    const rows = await db
      .insert(characters)
      .values({ ...validated, id: newId(CharacterIdSchema), createdAt: new Date() })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('characters への INSERT が行を返しませんでした')
    return characterRowToDomain(row)
  },

  async update(id, patch) {
    const validated = UpdateCharacterPatchSchema.parse(patch)
    const rows = await db.update(characters).set(validated).where(liveById(id)).returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('Character', id)
    return characterRowToDomain(row)
  },

  async softDelete(id) {
    const rows = await db
      .update(characters)
      .set({ deletedAt: new Date() })
      .where(liveById(id))
      .returning({ id: characters.id })
    if (rows.length === 0) throw new DbNotFoundError('Character', id)
  },

  async listIdentityImages(characterId) {
    const rows = await db
      .select()
      .from(characterIdentityImages)
      .where(eq(characterIdentityImages.characterId, characterId))
      .orderBy(asc(characterIdentityImages.order), asc(characterIdentityImages.id))
    return rows.map(identityImageRowToDomain)
  },

  async findIdentityImageById(id) {
    const rows = await db
      .select()
      .from(characterIdentityImages)
      .where(eq(characterIdentityImages.id, id))
      .limit(1)
    const row = rows[0]
    return row ? identityImageRowToDomain(row) : null
  },

  async addIdentityImage(input) {
    const validated = CreateCharacterIdentityImageInputSchema.parse(input)
    const rows = await db
      .insert(characterIdentityImages)
      .values({ ...validated, id: newId(CharacterIdentityImageIdSchema) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('character_identity_images への INSERT が行を返しませんでした')
    return identityImageRowToDomain(row)
  },

  async removeIdentityImage(id) {
    const rows = await db
      .delete(characterIdentityImages)
      .where(eq(characterIdentityImages.id, id))
      .returning({ id: characterIdentityImages.id })
    if (rows.length === 0) throw new DbNotFoundError('CharacterIdentityImage', id)
  },

  setPrimaryIdentityImage: (characterId, imageId, role) =>
    // 降格と昇格を 1 トランザクションにまとめる。途中で失敗すると
    // 同じ role に主画像が 2 枚（または 0 枚）残るため。
    db.transaction(async (tx) => {
      const sameRole = and(
        eq(characterIdentityImages.characterId, characterId),
        eq(characterIdentityImages.role, role),
      )
      await tx.update(characterIdentityImages).set({ isPrimary: false }).where(sameRole)
      const rows = await tx
        .update(characterIdentityImages)
        .set({ isPrimary: true })
        .where(and(eq(characterIdentityImages.id, imageId), sameRole))
        .returning()
      const row = rows[0]
      if (!row) throw new DbNotFoundError('CharacterIdentityImage', imageId)
      return identityImageRowToDomain(row)
    }),
})
