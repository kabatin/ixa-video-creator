import { asc, desc, eq, sql } from 'drizzle-orm'
import type { CreateTakeInput, ProjectId, ShotId, Take, TakeId, TakeUpdate } from '@ixa/domain'
import {
  CreateTakeInput as CreateTakeInputSchema,
  Take as TakeSchema,
  TakeId as TakeIdSchema,
  TakeUpdate as TakeUpdateSchema,
  newId,
} from '@ixa/domain'
import type { DbClient } from '../client.js'
import { DbNotFoundError } from '../errors.js'
import { takes } from '../schema/generation.js'
import { shots } from '../schema/shot.js'

/** drizzle の row 型。パッケージ外へは出さない。 */
export type TakeRow = typeof takes.$inferSelect

/**
 * Take は追記のみ（ADR-0003）。
 * UPDATE してよいのは `reviewStatus` と `humanVerdict` の 2 列だけで、
 * それ以外の列を更新するメソッドをこのリポジトリに追加してはならない。
 */
export type TakeRepository = {
  findById(id: TakeId): Promise<Take | null>
  /** index 昇順。 */
  findByShot(shotId: ShotId): Promise<Take[]>
  /**
   * Take を 1 行追記する。index は Shot 内の最大値 + 1 をリポジトリが採番する。
   * `input.id` は相互参照を解くために呼び出し側が採番できる（DOMAIN.md）。
   */
  create(input: CreateTakeInput): Promise<Take>
  /** reviewStatus / humanVerdict のみ更新できる（ADR-0003）。 */
  updateReview(takeId: TakeId, patch: TakeUpdate): Promise<Take>
  /**
   * 実際に支払ったコストの合計。見積りではなく Take に記録された実測値。
   * 全 Take を読み込まずに済むよう SQL で集計する（MV 全体では数百行になるため）。
   */
  sumCostByProject(projectId: ProjectId): Promise<number>
  sumCostByShot(shotId: ShotId): Promise<number>
}

/** row → Domain。zod で検証して branded ID を付ける。 */
export const takeRowToDomain = (row: TakeRow): Take =>
  TakeSchema.parse({
    id: row.id,
    shotId: row.shotId,
    index: row.index,
    mediaAssetId: row.mediaAssetId,
    spec: row.spec,
    specHash: row.specHash,
    providerId: row.providerId,
    modelId: row.modelId,
    providerParams: row.providerParams,
    seedUsed: row.seedUsed,
    costUsd: row.costUsd,
    generationTimeSec: row.generationTimeSec,
    parentTakeId: row.parentTakeId,
    regenerationReason: row.regenerationReason,
    reviewStatus: row.reviewStatus,
    humanVerdict: row.humanVerdict,
    createdAt: row.createdAt,
  })

export const createTakeRepository = (db: DbClient): TakeRepository => {
  /** Shot 内の次の連番。takes は 1 始まりで (shot_id, index) が UNIQUE。 */
  const nextIndex = async (shotId: ShotId): Promise<number> => {
    const rows = await db
      .select({ index: takes.index })
      .from(takes)
      .where(eq(takes.shotId, shotId))
      .orderBy(desc(takes.index))
      .limit(1)
    const highest = rows[0]
    return highest === undefined ? 1 : highest.index + 1
  }

  return {
    async findById(id) {
      const rows = await db.select().from(takes).where(eq(takes.id, id)).limit(1)
      const row = rows[0]
      return row ? takeRowToDomain(row) : null
    },

    async findByShot(shotId) {
      const rows = await db
        .select()
        .from(takes)
        .where(eq(takes.shotId, shotId))
        .orderBy(asc(takes.index))
      return rows.map(takeRowToDomain)
    },

    async create(input) {
      const validated = CreateTakeInputSchema.parse(input)
      const rows = await db
        .insert(takes)
        .values({
          ...validated,
          id: validated.id ?? newId(TakeIdSchema),
          index: await nextIndex(validated.shotId),
          reviewStatus: 'pending',
          humanVerdict: 'unreviewed',
          createdAt: new Date(),
        })
        .returning()
      const row = rows[0]
      if (!row) throw new Error('takes への INSERT が行を返しませんでした')
      return takeRowToDomain(row)
    },

    async updateReview(takeId, patch) {
      // TakeUpdate は reviewStatus / humanVerdict だけを持つ。
      // 他の列が混ざっても zod が strip するため DB へは渡らない（ADR-0003）。
      const validated = TakeUpdateSchema.parse(patch)
      const rows = await db.update(takes).set(validated).where(eq(takes.id, takeId)).returning()
      const row = rows[0]
      if (!row) throw new DbNotFoundError('Take', takeId)
      return takeRowToDomain(row)
    },

    async sumCostByProject(projectId) {
      // takes は shot_id しか持たないので shots を経由する。
      const rows = await db
        .select({ total: sql<string>`coalesce(sum(${takes.costUsd}), 0)` })
        .from(takes)
        .innerJoin(shots, eq(shots.id, takes.shotId))
        .where(eq(shots.projectId, projectId))
      return Number(rows[0]?.total ?? 0)
    },

    async sumCostByShot(shotId) {
      const rows = await db
        .select({ total: sql<string>`coalesce(sum(${takes.costUsd}), 0)` })
        .from(takes)
        .where(eq(takes.shotId, shotId))
      return Number(rows[0]?.total ?? 0)
    },
  }
}
