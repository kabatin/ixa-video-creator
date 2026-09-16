import { DbNotFoundError, type TakeRepository } from '@ixa/db'
import {
  CreateTakeInput as CreateTakeInputSchema,
  Take as TakeSchema,
  TakeId as TakeIdSchema,
  TakeUpdate as TakeUpdateSchema,
  newId,
  type ShotId,
  type Take,
  type TakeId,
} from '@ixa/domain'

/**
 * テスト用のインメモリ TakeRepository。実 DB には接続しない。
 * Take は追記のみ（ADR-0003）。updateReview 以外に更新手段を持たせない。
 */
export type InMemoryTakeRepository = TakeRepository & {
  readonly snapshot: () => readonly Take[]
}

export const createInMemoryTakeRepository = (
  seed: readonly Take[] = [],
): InMemoryTakeRepository => {
  let store: readonly Take[] = seed.map((take) => TakeSchema.parse(take))

  const find = (id: TakeId): Take | undefined => store.find((t) => t.id === id)

  const nextIndex = (shotId: ShotId): number =>
    store.filter((t) => t.shotId === shotId).reduce((max, t) => Math.max(max, t.index), 0) + 1

  return {
    snapshot: () => store,

    findById: (id) => Promise.resolve(find(id) ?? null),

    findByShot: (shotId) =>
      Promise.resolve(
        store.filter((take) => take.shotId === shotId).sort((a, b) => a.index - b.index),
      ),

    create: (input) => {
      const validated = CreateTakeInputSchema.parse(input)
      const created = TakeSchema.parse({
        ...validated,
        id: validated.id ?? newId(TakeIdSchema),
        index: nextIndex(validated.shotId),
        reviewStatus: 'pending',
        humanVerdict: 'unreviewed',
        createdAt: new Date(),
      })
      store = [...store, created]
      return Promise.resolve(created)
    },

    updateReview: (takeId, patch) => {
      const current = find(takeId)
      if (current === undefined) return Promise.reject(new DbNotFoundError('Take', takeId))
      // reviewStatus / humanVerdict 以外は zod が strip する（ADR-0003）。
      const validated = TakeUpdateSchema.parse(patch)
      const updated = TakeSchema.parse({ ...current, ...validated })
      store = store.map((take) => (take.id === takeId ? updated : take))
      return Promise.resolve(updated)
    },
  }
}
