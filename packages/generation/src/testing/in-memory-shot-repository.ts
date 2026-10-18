import { DbNotFoundError, type ShotRepository } from '@ixa/db'
import {
  CreateShotInput as CreateShotInputSchema,
  Shot as ShotSchema,
  ShotId as ShotIdSchema,
  UpdateShotPatch as UpdateShotPatchSchema,
  newId,
  type Shot,
  type ShotId,
} from '@ixa/domain'

/**
 * テスト用のインメモリ ShotRepository。実 DB には接続しない。
 * 実装と同じく Domain 型のみを返し、保持する値は毎回作り直す（破壊的変更をしない）。
 */
export type InMemoryShotRepository = ShotRepository & {
  readonly snapshot: () => readonly Shot[]
}

export const createInMemoryShotRepository = (
  seed: readonly Shot[] = [],
): InMemoryShotRepository => {
  let store: readonly Shot[] = seed.map((shot) => ShotSchema.parse(shot))
  /** 論理削除したもの。一覧・1 件の読みには出さず、`restore` だけが戻す。 */
  let deleted: readonly Shot[] = []

  const find = (id: ShotId): Shot | undefined => store.find((s) => s.id === id)

  const replace = (id: ShotId, patch: Partial<Shot>): Promise<Shot> => {
    const current = find(id)
    if (current === undefined) return Promise.reject(new DbNotFoundError('Shot', id))
    const updated = ShotSchema.parse({ ...current, ...patch, updatedAt: new Date() })
    store = store.map((shot) => (shot.id === id ? updated : shot))
    return Promise.resolve(updated)
  }

  return {
    snapshot: () => store,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByProject: (projectId) =>
      Promise.resolve(
        store.filter((shot) => shot.projectId === projectId).sort((a, b) => a.order - b.order),
      ),

    create: (input) => {
      const validated = CreateShotInputSchema.parse(input)
      const now = new Date()
      const created = ShotSchema.parse({
        ...validated,
        id: input.id ?? newId(ShotIdSchema),
        selectedTakeId: null,
        lockedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    createMany: (inputs) => {
      if (inputs.length === 0) return Promise.reject(new Error('createMany に空の配列が渡されました'))
      const now = new Date()
      const created = inputs.map((input) =>
        ShotSchema.parse({
          ...CreateShotInputSchema.parse(input),
          id: newId(ShotIdSchema),
          selectedTakeId: null,
          lockedAt: null,
          createdAt: now,
          updatedAt: now,
        }),
      )
      // 実物は 1 トランザクションで入れる。偽物も途中の状態を作らない。
      store = [...store, ...created]
      return Promise.resolve(created)
    },

    update: (id, patch) => replace(id, UpdateShotPatchSchema.parse(patch)),

    softDelete: (id) => {
      const current = find(id)
      if (current === undefined) return Promise.reject(new DbNotFoundError('Shot', id))
      store = store.filter((shot) => shot.id !== id)
      deleted = [...deleted, current]
      return Promise.resolve()
    },

    // 本物と同じく、同じコードの Shot が後から作られていれば一意制約で落ちる。
    restore: (id) => {
      const removed = deleted.find((shot) => shot.id === id)
      if (removed === undefined) return Promise.resolve(null)
      if (store.some((shot) => shot.projectId === removed.projectId && shot.code === removed.code)) {
        return Promise.reject(new Error('duplicate key value violates unique constraint "shots_project_id_code_uidx"'))
      }
      deleted = deleted.filter((shot) => shot.id !== id)
      store = [...store, removed]
      return Promise.resolve(removed)
    },

    selectTake: (shotId, takeId) => replace(shotId, { selectedTakeId: takeId }),

    updateStatus: (shotId, status) => replace(shotId, { status }),
  }
}
