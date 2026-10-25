import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type {
  Character, CharacterId, CharacterIdentityImage, CharacterIdentityImageId,
  CreateCharacterIdentityImageInput, CreateCharacterInput, IdentityImageRole,
  UpdateCharacterPatch, ProjectId,
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
import type { DbExecutor } from '../client.js'
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
  findByProject(projectId: ProjectId): Promise<Character[]>
  /** `id` は省ける（省けばここで振る）。取り消しの記録は書く前に作るので、作る前に ID を決めたい呼び手だけが渡す。 */
  create(input: CreateCharacterInput & { readonly id?: CharacterId }): Promise<Character>
  update(id: CharacterId, patch: UpdateCharacterPatch): Promise<Character>
  softDelete(id: CharacterId): Promise<void>
  /** 消したものを戻す（取り消し。2026-10-19）。同じ ID・同じ中身のまま論理削除を外す。消していない・無いなら `null`。 */
  restore(id: CharacterId): Promise<Character | null>

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
    projectId: row.projectId,
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    identityAnchors: row.identityAnchors,
    styleTokens: row.styleTokens,
    colorPalette: row.colorPalette,
    speakerNo: row.speakerNo,
    speechName: row.speechName,
    voiceDescription: row.voiceDescription,
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

/**
 * 作品の中の次の話し手の番号（ADR-0059）。**論理削除の行も数える**（消しても番号を詰めない・使い回さない）。
 * INSERT の中で数えるので、読んでから書くまでの間に別の行が入り込む隙を小さくする。
 * それでも同時に作れば一意索引（`characters_project_speaker_no_uq`）が片方を落とす（黙って重ねない）。
 */
const nextSpeakerNo = (projectId: ProjectId) =>
  sql<number>`(select coalesce(max(${characters.speakerNo}), 0) + 1 from ${characters} where ${characters.projectId} = ${projectId})`

const liveById = (id: CharacterId) => and(eq(characters.id, id), isNull(characters.deletedAt))

export const createCharacterRepository = (db: DbExecutor): CharacterRepository => ({
  async findById(id) {
    const rows = await db.select().from(characters).where(liveById(id)).limit(1)
    const row = rows[0]
    return row ? characterRowToDomain(row) : null
  },

  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(characters)
      .where(and(eq(characters.projectId, projectId), isNull(characters.deletedAt)))
      .orderBy(asc(characters.id))
    return rows.map(characterRowToDomain)
  },

  async create(input) {
    const validated = CreateCharacterInputSchema.parse(input)
    const rows = await db
      .insert(characters)
      .values({
        ...validated,
        id: input.id === undefined ? newId(CharacterIdSchema) : CharacterIdSchema.parse(input.id),
        speakerNo: nextSpeakerNo(validated.projectId),
        createdAt: new Date(),
      })
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

  async restore(id) {
    const rows = await db
      .update(characters)
      .set({ deletedAt: null })
      .where(and(eq(characters.id, id), isNotNull(characters.deletedAt)))
      .returning()
    const row = rows[0]
    return row === undefined ? null : characterRowToDomain(row)
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
