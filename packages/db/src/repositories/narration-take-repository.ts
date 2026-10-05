import { and, asc, desc, eq, inArray, max } from 'drizzle-orm'
import {
  NarrationTake as NarrationTakeSchema,
  NarrationTakeId as NarrationTakeIdSchema,
  newId,
  type CharTime,
  type NarrationLineId,
  type NarrationTake,
  type NarrationTakeId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { narrationTakes } from '../schema/narration.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type NarrationTakeRow = typeof narrationTakes.$inferSelect

/** 作るときの入力。番号（行の中の連番）と ID はリポジトリが振る。 */
export type CreateNarrationTakeInput = Omit<NarrationTake, 'id' | 'index' | 'createdAt'>

/** 声の Take の読み書き（ADR-0038）。**追記のみ**（字の時刻だけ後から足せる）。 */
export type NarrationTakeRepository = {
  findById(id: NarrationTakeId): Promise<NarrationTake | null>
  /** 行ごとの Take（番号の順）。 */
  findByLines(lineIds: readonly NarrationLineId[]): Promise<NarrationTake[]>
  /** 同じ指定で作った最新の Take（作り直さずに使い回すため）。 */
  findLatestBySpecHash(lineId: NarrationLineId, specHash: string): Promise<NarrationTake | null>
  create(input: CreateNarrationTakeInput): Promise<NarrationTake>
  /** 字の時刻を足す（時刻を返さない声に、後から文字起こしで付ける）。音・読みは変えない。 */
  setCharTimes(id: NarrationTakeId, charTimes: readonly CharTime[]): Promise<NarrationTake>
}

/** row → Domain。区間が壊れていれば失敗する。 */
export const narrationTakeRowToDomain = (row: NarrationTakeRow): NarrationTake =>
  NarrationTakeSchema.parse({
    id: row.id,
    lineId: row.lineId,
    index: row.index,
    source: row.source,
    mediaAssetId: row.mediaAssetId,
    inSec: row.inSec,
    outSec: row.outSec,
    spokenText: row.spokenText,
    displayText: row.displayText,
    specHash: row.specHash,
    charTimes: row.charTimes,
    loudnessLufs: row.loudnessLufs,
    peaks: row.peaks,
    costUsd: row.costUsd,
    createdAt: row.createdAt,
  })

export const createNarrationTakeRepository = (db: DbClient): NarrationTakeRepository => ({
  async findById(id) {
    const rows = await db.select().from(narrationTakes).where(eq(narrationTakes.id, id))
    const row = rows[0]
    return row === undefined ? null : narrationTakeRowToDomain(row)
  },

  async findByLines(lineIds) {
    if (lineIds.length === 0) return []
    const rows = await db
      .select()
      .from(narrationTakes)
      .where(inArray(narrationTakes.lineId, [...lineIds]))
      .orderBy(asc(narrationTakes.lineId), asc(narrationTakes.index))
    return rows.map(narrationTakeRowToDomain)
  },

  async findLatestBySpecHash(lineId, specHash) {
    const rows = await db
      .select()
      .from(narrationTakes)
      .where(and(eq(narrationTakes.lineId, lineId), eq(narrationTakes.specHash, specHash)))
      .orderBy(desc(narrationTakes.index))
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : narrationTakeRowToDomain(row)
  },

  async create(input) {
    const valid = NarrationTakeSchema.parse({ ...input, id: newId(NarrationTakeIdSchema), index: 1, createdAt: new Date() })
    // 番号は行の中の最大 + 1。同じ行の声は worker が 1 つずつ作るので、取引の中で数えれば重ならない（重なれば一意制約で止まる）。
    const row = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ value: max(narrationTakes.index) })
        .from(narrationTakes)
        .where(eq(narrationTakes.lineId, valid.lineId))
      const inserted = await tx
        .insert(narrationTakes)
        .values({
          id: valid.id,
          lineId: valid.lineId,
          index: (current?.value ?? 0) + 1,
          source: valid.source,
          mediaAssetId: valid.mediaAssetId,
          inSec: valid.inSec,
          outSec: valid.outSec,
          spokenText: valid.spokenText,
          displayText: valid.displayText,
          specHash: valid.specHash,
          charTimes: valid.charTimes === null ? null : [...valid.charTimes],
          loudnessLufs: valid.loudnessLufs,
          peaks: valid.peaks === null ? null : [...valid.peaks],
          costUsd: valid.costUsd,
          createdAt: valid.createdAt,
        })
        .returning()
      return inserted[0]
    })
    if (row === undefined) throw new Error('声の Take を作れませんでした')
    return narrationTakeRowToDomain(row)
  },

  async setCharTimes(id, charTimes) {
    const rows = await db
      .update(narrationTakes)
      .set({ charTimes: [...charTimes] })
      .where(eq(narrationTakes.id, id))
      .returning()
    const row = rows[0]
    if (row === undefined) throw new DbNotFoundError('narration_takes', id)
    return narrationTakeRowToDomain(row)
  },
})
