import { and, asc, eq } from 'drizzle-orm'
import type { CharacterId, ShotCharacter, ShotId } from '@ixa/domain'
import { ShotCharacter as ShotCharacterSchema } from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { shotCharacters } from '../schema/shot.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type ShotCharacterRow = typeof shotCharacters.$inferSelect

/**
 * shotId を除いた登場人物 1 件分。
 * `replaceAll` は shotId を引数で受け取るため、要素側に持たせると正が 2 つになる。
 */
export type ShotCharacterEntry = Omit<ShotCharacter, 'shotId'>

/**
 * Shot と登場人物の紐づけ（DOMAIN.md §9 ShotCharacter）。
 *
 * **この表は複合主キー (shot_id, character_id) で、独自の id を持たない。**
 * 同じ Shot に同じ Character が 2 回出ることはないため、代理キーを置く意味がない。
 * よって 1 件の指定は常に (shotId, characterId) の組で行う。
 *
 * lookId は必須。実行時に既定 Look を解決させず、決めた時点の値を保存する。
 */
export type ShotCharacterRepository = {
  /** order 昇順。同順は characterId 昇順で安定させる。 */
  findByShot(shotId: ShotId): Promise<ShotCharacter[]>
  add(input: ShotCharacter): Promise<ShotCharacter>
  remove(shotId: ShotId, characterId: CharacterId): Promise<void>
  /** Shot の登場人物を丸ごと置き換える。差分計算を呼び出し側に持たせない。 */
  replaceAll(shotId: ShotId, entries: readonly ShotCharacterEntry[]): Promise<ShotCharacter[]>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const shotCharacterRowToDomain = (row: ShotCharacterRow): ShotCharacter =>
  ShotCharacterSchema.parse({
    shotId: row.shotId,
    characterId: row.characterId,
    lookId: row.lookId,
    prominence: row.prominence,
    order: row.order,
  })

const byShot = (shotId: ShotId) => eq(shotCharacters.shotId, shotId)

const byKey = (shotId: ShotId, characterId: CharacterId) =>
  and(byShot(shotId), eq(shotCharacters.characterId, characterId))

const ORDER = [asc(shotCharacters.order), asc(shotCharacters.characterId)] as const

export const createShotCharacterRepository = (db: DbClient): ShotCharacterRepository => ({
  async findByShot(shotId) {
    const rows = await db.select().from(shotCharacters).where(byShot(shotId)).orderBy(...ORDER)
    return rows.map(shotCharacterRowToDomain)
  },

  async add(input) {
    const validated = ShotCharacterSchema.parse(input)
    const rows = await db.insert(shotCharacters).values(validated).returning()
    const row = rows[0]
    if (!row) throw new Error('shot_characters への INSERT が行を返しませんでした')
    return shotCharacterRowToDomain(row)
  },

  async remove(shotId, characterId) {
    const rows = await db
      .delete(shotCharacters)
      .where(byKey(shotId, characterId))
      .returning({ characterId: shotCharacters.characterId })
    if (rows.length === 0) throw new DbNotFoundError('ShotCharacter', characterId)
  },

  replaceAll(shotId, entries) {
    // 全消し + 入れ直しを 1 トランザクションにまとめる。
    // 途中で失敗すると Shot から登場人物が消えたまま残り、生成が静かに劣化するため。
    const validated = entries.map((entry) => ShotCharacterSchema.parse({ ...entry, shotId }))
    return db.transaction(async (tx) => {
      await tx.delete(shotCharacters).where(byShot(shotId))
      if (validated.length === 0) return []
      const rows = await tx.insert(shotCharacters).values(validated).returning()
      return rows.map(shotCharacterRowToDomain).sort(byOrderThenCharacterId)
    })
  },
})

const byOrderThenCharacterId = (a: ShotCharacter, b: ShotCharacter): number =>
  a.order - b.order || (a.characterId < b.characterId ? -1 : 1)
