import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type {
  CreateStoryboardDraftItemInput,
  CreateStoryboardDraftRunInput,
  ProjectId,
  ShotId,
  StoryboardDraftItem,
  StoryboardDraftItemId,
  StoryboardDraftRun,
  StoryboardDraftRunId,
} from '@ixa/domain'
import {
  CreateStoryboardDraftItemInput as CreateStoryboardDraftItemInputSchema,
  CreateStoryboardDraftRunInput as CreateStoryboardDraftRunInputSchema,
  StoryboardDraftItem as StoryboardDraftItemSchema,
  StoryboardDraftItemId as StoryboardDraftItemIdSchema,
  StoryboardDraftRun as StoryboardDraftRunSchema,
  StoryboardDraftRunId as StoryboardDraftRunIdSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { storyboardDraftItems, storyboardDraftRuns } from '../schema/storyboard.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type StoryboardDraftRunRow = typeof storyboardDraftRuns.$inferSelect
export type StoryboardDraftItemRow = typeof storyboardDraftItems.$inferSelect

/**
 * 絵コンテ下書きの読み書き（PHASE 6.3）。
 *
 * **案の中身は追記のみ。** `description` / `mood` / `reason` を書き換える口は用意しない。
 * 作り直すなら新しい run を作る（Take の Immutability と同じ考え方・ADR-0003）。
 * 後から動くのは run の `status` / `costUsd` / `error` と、案の `adoptedAt` だけ。
 */
export type StoryboardDraftRepository = {
  findRunById(id: StoryboardDraftRunId): Promise<StoryboardDraftRun | null>
  /** 直近の実行が先頭（ULID 降順）。 */
  findRunsByProject(projectId: ProjectId): Promise<StoryboardDraftRun[]>
  findLatestRunByProject(projectId: ProjectId): Promise<StoryboardDraftRun | null>
  createRun(input: CreateStoryboardDraftRunInput): Promise<StoryboardDraftRun>
  /** 実行の進行を書く。ここ以外で run を UPDATE しない。 */
  updateRun(
    id: StoryboardDraftRunId,
    patch: Pick<StoryboardDraftRun, 'status' | 'costUsd' | 'error'>,
  ): Promise<StoryboardDraftRun>
  /**
   * 案をまとめて追記する。**1 トランザクションで入れる。**
   * 途中で失敗して一部だけ残ると、「68 件ぶん作ったはずが 40 件しかない」状態が
   * 失敗と区別できなくなる。空配列は「案なし」なので例外にせず空配列を返す。
   */
  addItems(
    runId: StoryboardDraftRunId,
    inputs: readonly CreateStoryboardDraftItemInput[],
  ): Promise<StoryboardDraftItem[]>
  findItemsByRun(runId: StoryboardDraftRunId): Promise<StoryboardDraftItem[]>
  /**
   * 採用を記録する。**案の中身は触らない。**
   * 既に採用済みの案を渡しても時刻は上書きしない（最初に人が決めた時刻を残す）。
   * 返すのは実際に採用が記録された案だけ。
   */
  adoptItems(ids: readonly StoryboardDraftItemId[], at: Date): Promise<StoryboardDraftItem[]>
}

const runRowToDomain = (row: StoryboardDraftRunRow): StoryboardDraftRun =>
  StoryboardDraftRunSchema.parse({
    id: row.id,
    projectId: row.projectId,
    drafter: row.drafter,
    status: row.status,
    costUsd: row.costUsd,
    error: row.error,
    createdAt: row.createdAt,
  })

const itemRowToDomain = (row: StoryboardDraftItemRow): StoryboardDraftItem =>
  StoryboardDraftItemSchema.parse({
    id: row.id,
    runId: row.runId,
    shotId: row.shotId,
    description: row.description,
    mood: row.mood,
    reason: row.reason,
    adoptedAt: row.adoptedAt,
    createdAt: row.createdAt,
  })

export const createStoryboardDraftRepository = (db: DbClient): StoryboardDraftRepository => ({
  findRunById: async (id) => {
    const [row] = await db
      .select()
      .from(storyboardDraftRuns)
      .where(eq(storyboardDraftRuns.id, id))
      .limit(1)
    return row === undefined ? null : runRowToDomain(row)
  },

  findRunsByProject: async (projectId) => {
    const rows = await db
      .select()
      .from(storyboardDraftRuns)
      .where(eq(storyboardDraftRuns.projectId, projectId))
      .orderBy(desc(storyboardDraftRuns.id))
    return rows.map(runRowToDomain)
  },

  findLatestRunByProject: async (projectId) => {
    const [row] = await db
      .select()
      .from(storyboardDraftRuns)
      .where(eq(storyboardDraftRuns.projectId, projectId))
      .orderBy(desc(storyboardDraftRuns.id))
      .limit(1)
    return row === undefined ? null : runRowToDomain(row)
  },

  createRun: async (input) => {
    const parsed = CreateStoryboardDraftRunInputSchema.parse(input)
    const [row] = await db
      .insert(storyboardDraftRuns)
      .values({ id: newId(StoryboardDraftRunIdSchema), ...parsed })
      .returning()
    if (row === undefined) throw new Error('storyboard_draft_runs の作成に失敗しました')
    return runRowToDomain(row)
  },

  updateRun: async (id, patch) => {
    const [row] = await db
      .update(storyboardDraftRuns)
      .set({ status: patch.status, costUsd: patch.costUsd, error: patch.error })
      .where(eq(storyboardDraftRuns.id, id))
      .returning()
    if (row === undefined) throw new DbNotFoundError('storyboard_draft_runs', id)
    return runRowToDomain(row)
  },

  addItems: async (runId, inputs) => {
    if (inputs.length === 0) return []
    const values = inputs.map((input) => {
      const parsed = CreateStoryboardDraftItemInputSchema.parse(input)
      return { id: newId(StoryboardDraftItemIdSchema), runId, ...parsed }
    })
    const rows = await db.insert(storyboardDraftItems).values(values).returning()
    return rows.map(itemRowToDomain)
  },

  findItemsByRun: async (runId) => {
    const rows = await db
      .select()
      .from(storyboardDraftItems)
      .where(eq(storyboardDraftItems.runId, runId))
    return rows.map(itemRowToDomain)
  },

  adoptItems: async (ids, at) => {
    if (ids.length === 0) return []
    // **既に採用済みの行は触らない。** 最初に人が決めた時刻を残すため、
    // `adopted_at is null` を条件に入れる。ここを緩めると、押し直すたびに
    // 「いつ決めたか」が今の時刻へ上書きされ、判断の履歴が消える。
    const rows = await db
      .update(storyboardDraftItems)
      .set({ adoptedAt: at })
      .where(and(inArray(storyboardDraftItems.id, [...ids]), isNull(storyboardDraftItems.adoptedAt)))
      .returning()
    return rows.map(itemRowToDomain)
  },
})

/** Shot ごとの最新の案を引くための補助。**採用済みかどうかでは絞らない。** */
export const itemsByShot = (
  items: readonly StoryboardDraftItem[],
): ReadonlyMap<ShotId, StoryboardDraftItem> =>
  new Map(items.map((item) => [item.shotId, item] as const))
