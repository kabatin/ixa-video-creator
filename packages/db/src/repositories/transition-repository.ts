import { asc, eq } from 'drizzle-orm'
import type { CreateTransitionInput, ProjectId, Transition, TransitionId } from '@ixa/domain'
import {
  CreateTransitionInput as CreateTransitionInputSchema,
  Transition as TransitionSchema,
  TransitionId as TransitionIdSchema,
  newId,
} from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { transitions } from '../schema/shot.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type TransitionRow = typeof transitions.$inferSelect

/**
 * Transition の読み書き。戻り値は必ず `@ixa/domain` の型。
 *
 * 更新口は持たない。Transition は (fromShotId, toShotId) に対して一意なので、
 * 付け替えは delete + create で表す。
 * ソフトデリートもしない（transitions テーブルは deleted_at を持たない）。
 */
/**
 * 作るトランジション。**`id` は省ける**（省けばここで振る）。取り消しの記録は書く前に作るので作る前に ID を決めたい呼び手と、
 * 消したものを同じ ID で置き直す取り消しだけが渡す。
 */
export type NewTransition = CreateTransitionInput & { readonly id?: TransitionId }

export type TransitionRepository = {
  /** 投入順（ULID の昇順 = 時系列）。 */
  findByProject(projectId: ProjectId): Promise<Transition[]>
  findById(id: TransitionId): Promise<Transition | null>
  create(input: NewTransition): Promise<Transition>
  delete(id: TransitionId): Promise<void>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const transitionRowToDomain = (row: TransitionRow): Transition =>
  TransitionSchema.parse({
    id: row.id,
    projectId: row.projectId,
    fromShotId: row.fromShotId,
    toShotId: row.toShotId,
    type: row.type,
    durationSec: row.durationSec,
  })

export const createTransitionRepository = (db: DbExecutor): TransitionRepository => ({
  async findByProject(projectId) {
    const rows = await db
      .select()
      .from(transitions)
      .where(eq(transitions.projectId, projectId))
      .orderBy(asc(transitions.id))
    return rows.map(transitionRowToDomain)
  },

  async findById(id) {
    const rows = await db.select().from(transitions).where(eq(transitions.id, id)).limit(1)
    const row = rows[0]
    return row === undefined ? null : transitionRowToDomain(row)
  },

  async create(input) {
    const validated = CreateTransitionInputSchema.parse(input)
    // 渡された ID は検証してから使う（規約 4）。
    const id = input.id === undefined ? newId(TransitionIdSchema) : TransitionIdSchema.parse(input.id)
    const rows = await db
      .insert(transitions)
      .values({ ...validated, id })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('transitions への INSERT が行を返しませんでした')
    return transitionRowToDomain(row)
  },

  async delete(id) {
    const rows = await db
      .delete(transitions)
      .where(eq(transitions.id, id))
      .returning({ id: transitions.id })
    if (rows.length === 0) throw new DbNotFoundError('Transition', id)
  },
})
