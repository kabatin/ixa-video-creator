import { and, asc, eq, isNull } from 'drizzle-orm'
import type {
  CreateSequenceInput, ProjectId, Sequence, SequenceId, UpdateSequencePatch,
} from '@ixa/domain'
import {
  CreateSequenceInput as CreateSequenceInputSchema,
  Sequence as SequenceSchema,
  SequenceId as SequenceIdSchema,
  UpdateSequencePatch as UpdateSequencePatchSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { sequences } from '../schema/script.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type SequenceRow = typeof sequences.$inferSelect

/**
 * Sequence（楽曲構成に沿った Shot のまとまり）の読み書き（DOMAIN.md §8）。
 * 戻り値は必ず `@ixa/domain` の型。
 *
 * order は呼び出し側が決める。リポジトリが採番すると、途中への差し込みを
 * 表現できなくなるため（ScriptVersion.version との違いはここ）。
 */
export type SequenceRepository = {
  findById(id: SequenceId): Promise<Sequence | null>
  /** order 昇順。同順は id 昇順（= 作成順）で安定させる。ソフトデリート済みは含まない。 */
  findByProject(projectId: ProjectId): Promise<Sequence[]>
  create(input: CreateSequenceInput): Promise<Sequence>
  update(id: SequenceId, patch: UpdateSequencePatch): Promise<Sequence>
  softDelete(id: SequenceId): Promise<void>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const sequenceRowToDomain = (row: SequenceRow): Sequence =>
  SequenceSchema.parse({
    id: row.id,
    projectId: row.projectId,
    order: row.order,
    name: row.name,
    musicSectionLabel: row.musicSectionLabel,
    notes: row.notes,
  })

const liveById = (id: SequenceId) => and(eq(sequences.id, id), isNull(sequences.deletedAt))

export const createSequenceRepository = (db: DbClient): SequenceRepository => ({
  async findById(id) {
    const rows = await db.select().from(sequences).where(liveById(id)).limit(1)
    const row = rows[0]
    return row ? sequenceRowToDomain(row) : null
  },

  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(sequences)
      .where(and(eq(sequences.projectId, projectId), isNull(sequences.deletedAt)))
      .orderBy(asc(sequences.order), asc(sequences.id))
    return rows.map(sequenceRowToDomain)
  },

  async create(input) {
    const validated = CreateSequenceInputSchema.parse(input)
    const rows = await db
      .insert(sequences)
      .values({ ...validated, id: newId(SequenceIdSchema) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('sequences への INSERT が行を返しませんでした')
    return sequenceRowToDomain(row)
  },

  async update(id, patch) {
    const validated = UpdateSequencePatchSchema.parse(patch)
    const rows = await db.update(sequences).set(validated).where(liveById(id)).returning()
    const row = rows[0]
    if (!row) throw new DbNotFoundError('Sequence', id)
    return sequenceRowToDomain(row)
  },

  async softDelete(id) {
    const rows = await db
      .update(sequences)
      .set({ deletedAt: new Date() })
      .where(liveById(id))
      .returning({ id: sequences.id })
    if (rows.length === 0) throw new DbNotFoundError('Sequence', id)
  },
})
