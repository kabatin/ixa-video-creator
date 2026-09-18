import { DbNotFoundError, type EditBatchRepository } from '@ixa/db'
import {
  CreateEditBatchInput as CreateEditBatchInputSchema,
  EditBatch as EditBatchSchema,
  EditBatchId as EditBatchIdSchema,
  newId,
  type EditBatch,
  type EditBatchId,
} from '@ixa/domain'

/**
 * テスト用のインメモリ `EditBatchRepository`。実 DB には接続しない。
 *
 * ★ **`markUndone` の振る舞いを実装と揃える。** 既に取り消し済みなら `null`、
 *   行そのものが無ければ `DbNotFoundError`。ここを緩めると、
 *   「二度取り消さない」を守っているつもりのテストが素通りする。
 */
export type InMemoryEditBatchRepository = EditBatchRepository & {
  /** 現在保持している記録（直近が先頭）。 */
  readonly snapshot: () => readonly EditBatch[]
}

export const createInMemoryEditBatchRepository = (
  seed: readonly EditBatch[] = [],
): InMemoryEditBatchRepository => {
  let store: readonly EditBatch[] = seed.map((batch) => EditBatchSchema.parse(batch))

  /** 実装と同じ ULID 降順。直近が先頭。 */
  const newestFirst = (batches: readonly EditBatch[]): readonly EditBatch[] =>
    [...batches].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))

  return {
    snapshot: () => newestFirst(store),

    findByProject: (projectId, limit = 50) =>
      Promise.resolve(
        newestFirst(store.filter((batch) => batch.projectId === projectId)).slice(0, limit),
      ),

    findById: (id) => Promise.resolve(store.find((batch) => batch.id === id) ?? null),

    create: (input) => {
      const parsed = CreateEditBatchInputSchema.parse(input)
      const created = EditBatchSchema.parse({
        id: newId(EditBatchIdSchema),
        projectId: parsed.projectId,
        kind: parsed.kind,
        summary: parsed.summary,
        entries: parsed.entries,
        undoneAt: null,
        createdAt: new Date(),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    markUndone: (id: EditBatchId, at: Date) => {
      const found = store.find((batch) => batch.id === id)
      if (found === undefined) {
        return Promise.reject(new DbNotFoundError('shot_edit_batches', id))
      }
      // **既に取り消し済みなら何もしない。** 二度目は `null`。
      if (found.undoneAt !== null) return Promise.resolve(null)

      const updated: EditBatch = { ...found, undoneAt: at }
      store = store.map((batch) => (batch.id === id ? updated : batch))
      return Promise.resolve(updated)
    },
  }
}
