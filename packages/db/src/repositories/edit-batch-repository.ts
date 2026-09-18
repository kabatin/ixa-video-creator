import { and, desc, eq, isNull } from 'drizzle-orm'
import type { CreateEditBatchInput, EditBatch, EditBatchId, ProjectId } from '@ixa/domain'
import {
  CreateEditBatchInput as CreateEditBatchInputSchema,
  EditBatch as EditBatchSchema,
  EditBatchId as EditBatchIdSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { shotEditBatches } from '../schema/edit-batch.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type EditBatchRow = typeof shotEditBatches.$inferSelect

/**
 * 一括編集の記録と取り消し（横断 ROADMAP: Undo と履歴）。
 *
 * **中身は追記のみ。** `entries` を書き換える口は用意しない。
 * 書き換えると「取り消したら何が戻るのか」が変わり、人が見た内容と
 * 実際に戻る内容が食い違う（Take・絵コンテの案と同じ・ADR-0003）。
 */
export type EditBatchRepository = {
  /** 直近が先頭（ULID 降順）。履歴としてそのまま並べられる。 */
  findByProject(projectId: ProjectId, limit?: number): Promise<EditBatch[]>
  findById(id: EditBatchId): Promise<EditBatch | null>
  create(input: CreateEditBatchInput): Promise<EditBatch>
  /**
   * 取り消し済みの印を付ける。**既に取り消した記録には二度付けない。**
   * 二度当てると、その後に人が直した内容を古い値で塗り潰す。
   * 付かなかったときは `null` を返す（例外にしない。呼ぶ側が理由を出す）。
   */
  markUndone(id: EditBatchId, at: Date): Promise<EditBatch | null>
}

const rowToDomain = (row: EditBatchRow): EditBatch =>
  EditBatchSchema.parse({
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    summary: row.summary,
    entries: row.entries,
    undoneAt: row.undoneAt,
    createdAt: row.createdAt,
  })

/** 履歴に出す既定の件数。全部返すと、長く使った Project で画面が重くなる。 */
export const DEFAULT_EDIT_BATCH_LIMIT = 50

export const createEditBatchRepository = (db: DbClient): EditBatchRepository => ({
  findByProject: async (projectId, limit = DEFAULT_EDIT_BATCH_LIMIT) => {
    const rows = await db
      .select()
      .from(shotEditBatches)
      .where(eq(shotEditBatches.projectId, projectId))
      .orderBy(desc(shotEditBatches.id))
      .limit(limit)
    return rows.map(rowToDomain)
  },

  findById: async (id) => {
    const [row] = await db
      .select()
      .from(shotEditBatches)
      .where(eq(shotEditBatches.id, id))
      .limit(1)
    return row === undefined ? null : rowToDomain(row)
  },

  create: async (input) => {
    const parsed = CreateEditBatchInputSchema.parse(input)
    const [row] = await db
      .insert(shotEditBatches)
      .values({ id: newId(EditBatchIdSchema), ...parsed })
      .returning()
    if (row === undefined) throw new Error('shot_edit_batches の作成に失敗しました')
    return rowToDomain(row)
  },

  markUndone: async (id, at) => {
    // **まだ取り消していないものだけ。** 二重の取り消しを DB の条件で止める。
    const [row] = await db
      .update(shotEditBatches)
      .set({ undoneAt: at })
      .where(and(eq(shotEditBatches.id, id), isNull(shotEditBatches.undoneAt)))
      .returning()
    if (row !== undefined) return rowToDomain(row)

    // 行そのものが無いのか、既に取り消し済みなのかを呼ぶ側が分けられるようにする。
    const [existing] = await db
      .select()
      .from(shotEditBatches)
      .where(eq(shotEditBatches.id, id))
      .limit(1)
    if (existing === undefined) throw new DbNotFoundError('shot_edit_batches', id)
    return null
  },
})
