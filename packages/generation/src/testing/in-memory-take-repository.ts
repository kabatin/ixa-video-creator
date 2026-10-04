import { DbNotFoundError, type TakeRepository, type TakeVisibility } from '@ixa/db'
import {
  CreateTakeInput as CreateTakeInputSchema,
  Take as TakeSchema,
  TakeId as TakeIdSchema,
  TakeUpdate as TakeUpdateSchema,
  newId,
  type ShotId,
  type Take,
  type TakeId,
  countsAsSpend,
} from '@ixa/domain'

/**
 * テスト用のインメモリ TakeRepository。実 DB には接続しない。
 * Take は追記のみ（ADR-0003）。updateReview 以外に更新手段を持たせない。
 */
export type InMemoryTakeRepository = TakeRepository & {
  readonly snapshot: () => readonly Take[]
  /** 見えなくした Take の ID（「Take を消す」）。 */
  readonly hiddenIds: () => ReadonlySet<TakeId>
}

export const createInMemoryTakeRepository = (
  seed: readonly Take[] = [],
): InMemoryTakeRepository => {
  let store: readonly Take[] = seed.map((take) => TakeSchema.parse(take))

  let hidden: ReadonlySet<TakeId> = new Set()
  const find = (id: TakeId): Take | undefined => store.find((t) => t.id === id)
  const visible = (take: Take, visibility?: TakeVisibility): boolean =>
    visibility?.includeHidden === true || !hidden.has(take.id)

  const nextIndex = (shotId: ShotId): number =>
    store.filter((t) => t.shotId === shotId).reduce((max, t) => Math.max(max, t.index), 0) + 1

  return {
    // 偽物なので projectId は見ず、全 Take を合算する。
    // テストは 1 プロジェクトしか作らないため、これで十分。
    // 複製で写した Take は元の作品で払っているので数えない（本物と同じ。`countsAsSpend`）。
    sumCostByProject: () =>
      Promise.resolve(store.filter(countsAsSpend).reduce((total, take) => total + take.costUsd, 0)),
    sumCostByShot: (shotId: ShotId) =>
      Promise.resolve(
        store
          .filter((t) => t.shotId === shotId && countsAsSpend(t))
          .reduce((total, take) => total + take.costUsd, 0),
      ),
    snapshot: () => store,
    hiddenIds: () => hidden,

    findById: (id, visibility) => {
      const take = find(id)
      return Promise.resolve(take !== undefined && visible(take, visibility) ? take : null)
    },

    findByShot: (shotId, visibility) =>
      Promise.resolve(
        store
          .filter((take) => take.shotId === shotId && visible(take, visibility))
          .sort((a, b) => a.index - b.index),
      ),

    hide: (takeId) => {
      const take = find(takeId)
      if (take === undefined || hidden.has(takeId)) {
        return Promise.reject(new DbNotFoundError('Take', takeId))
      }
      hidden = new Set([...hidden, takeId])
      return Promise.resolve()
    },

    // 偽物なので projectId は見ず、全 Take を返す（`sumCostByProject` と同じ割り切り）。
    // 本物は論理削除済み Shot の Take も含めるので、ここでも取りこぼしを作らない。
    findByProject: () => Promise.resolve([...store].sort((a, b) => (a.id < b.id ? -1 : 1))),

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
