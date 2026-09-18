import { DbNotFoundError, type StoryboardDraftRepository } from '@ixa/db'
import {
  CreateStoryboardDraftItemInput as CreateStoryboardDraftItemInputSchema,
  CreateStoryboardDraftRunInput as CreateStoryboardDraftRunInputSchema,
  StoryboardDraftItem as StoryboardDraftItemSchema,
  StoryboardDraftItemId as StoryboardDraftItemIdSchema,
  StoryboardDraftRun as StoryboardDraftRunSchema,
  StoryboardDraftRunId as StoryboardDraftRunIdSchema,
  newId,
  type StoryboardDraftItem,
  type StoryboardDraftRun,
  type StoryboardDraftRunId,
} from '@ixa/domain'

/**
 * テスト用のインメモリ絵コンテ下書きリポジトリ（P63-4）。実 DB には接続しない。
 *
 * **本物と同じ約束を守る。** 守らないと、本物なら落ちる操作がテストでは通ってしまう。
 * - 案の中身は追記のみ（`description` / `mood` / `reason` を書き換える口を持たない）
 * - 1 回の run で同じ Shot に 2 つの案は作れない（`(run_id, shot_id)` の一意制約）
 * - 採用済みの案に再び採用を書いても、**最初の時刻を残す**
 */

export type InMemoryStoryboardDraftRepository = StoryboardDraftRepository & {
  /** 保存されている案すべて。「押していない Shot が変わっていない」の確認に使う。 */
  readonly itemSnapshot: () => readonly StoryboardDraftItem[]
  readonly runSnapshot: () => readonly StoryboardDraftRun[]
}

export class DuplicateDraftItemError extends Error {
  constructor(runId: StoryboardDraftRunId, shotId: string) {
    super(`同じ run に同じ Shot の案が既にあります（run=${runId} / shot=${shotId}）`)
    this.name = 'DuplicateDraftItemError'
  }
}

export const createInMemoryStoryboardDraftRepository = (): InMemoryStoryboardDraftRepository => {
  let runs: readonly StoryboardDraftRun[] = []
  let items: readonly StoryboardDraftItem[] = []

  const findRun = (id: StoryboardDraftRunId): StoryboardDraftRun | undefined =>
    runs.find((run) => run.id === id)

  return {
    itemSnapshot: () => items,
    runSnapshot: () => runs,

    findRunById: (id) => Promise.resolve(findRun(id) ?? null),

    findRunsByProject: (projectId) =>
      Promise.resolve(
        runs.filter((run) => run.projectId === projectId).sort((a, b) => (a.id < b.id ? 1 : -1)),
      ),

    findLatestRunByProject: (projectId) => {
      const [latest] = runs
        .filter((run) => run.projectId === projectId)
        .sort((a, b) => (a.id < b.id ? 1 : -1))
      return Promise.resolve(latest ?? null)
    },

    createRun: (input) => {
      const created = StoryboardDraftRunSchema.parse({
        ...CreateStoryboardDraftRunInputSchema.parse(input),
        id: newId(StoryboardDraftRunIdSchema),
        createdAt: new Date(),
      })
      runs = [...runs, created]
      return Promise.resolve(created)
    },

    updateRun: (id, patch) => {
      const run = findRun(id)
      if (run === undefined) {
        return Promise.reject(new DbNotFoundError('storyboard_draft_runs', id))
      }
      const updated = StoryboardDraftRunSchema.parse({ ...run, ...patch })
      runs = runs.map((existing) => (existing.id === id ? updated : existing))
      return Promise.resolve(updated)
    },

    addItems: (runId, inputs) => {
      if (inputs.length === 0) return Promise.resolve([])

      const existingShotIds = new Set(
        items.filter((item) => item.runId === runId).map((item) => item.shotId),
      )
      const created: StoryboardDraftItem[] = []

      for (const input of inputs) {
        const parsed = CreateStoryboardDraftItemInputSchema.parse(input)
        if (existingShotIds.has(parsed.shotId)) {
          // 本物は一意制約で落ちる。**同じ失敗をテストでも起こす。**
          return Promise.reject(new DuplicateDraftItemError(runId, parsed.shotId))
        }
        existingShotIds.add(parsed.shotId)
        created.push(
          StoryboardDraftItemSchema.parse({
            ...parsed,
            id: newId(StoryboardDraftItemIdSchema),
            runId,
            adoptedAt: null,
            createdAt: new Date(),
          }),
        )
      }

      // 追記のみ。既存の要素には触れない。
      items = [...items, ...created]
      return Promise.resolve(created)
    },

    findItemsByRun: (runId) => Promise.resolve(items.filter((item) => item.runId === runId)),

    adoptItems: (ids, at) => {
      if (ids.length === 0) return Promise.resolve([])
      const target = new Set(ids)
      const adopted: StoryboardDraftItem[] = []

      items = items.map((item) => {
        // **既に採用済みなら時刻を上書きしない。** 最初に人が決めた時刻を残す。
        if (!target.has(item.id) || item.adoptedAt !== null) return item
        const updated = StoryboardDraftItemSchema.parse({ ...item, adoptedAt: at })
        adopted.push(updated)
        return updated
      })

      return Promise.resolve(adopted)
    },
  }
}
